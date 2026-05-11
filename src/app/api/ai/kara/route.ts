import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Load source files into memory ONCE at module init ───────────────────────
// We bake the actual rule-engine source code + database schema directly into
// Kara's context so she reasons from real logic rather than paraphrased
// descriptions. Read at module load so it's held in Node memory across
// requests; combined with Anthropic's prompt caching (see cache_control
// below), each Kara request after the first costs ~10% of the full input.
//
// Loaded defensively: if a file is missing in some weird deploy state,
// fall back to an empty string rather than crashing the route.

function safeRead(relativePath: string): string {
  try {
    return readFileSync(join(process.cwd(), relativePath), "utf-8");
  } catch (e) {
    console.warn(`[api/ai/kara] could not read ${relativePath}:`, (e as any)?.message);
    return "";
  }
}

const RULE_ENGINE_SOURCE = safeRead("src/lib/rule-engine.ts");
const SCHEMA_SQL_SOURCE = safeRead("supabase/schema.sql");

// ── Build the base system prompt ────────────────────────────────────────────
//
// Structure (order matters for cache effectiveness — static-first, dynamic-last):
//   1. Identity & instructions (rarely changes) — CACHED
//   2. Rule engine source code (rarely changes) — CACHED
//   3. Database schema (rarely changes) — CACHED
//   4. Admin override (changes whenever an admin edits it) — NOT CACHED
//
// Anthropic prompt caching applies to a `cache_control: { type: "ephemeral" }`
// marker placed at a specific point in the system blocks; everything BEFORE
// (and at) the marker is cached. So the marker goes between (3) and (4).

const KARA_BASE_INSTRUCTIONS = `You are **Kara**, the in-app expert for Tenkara Inbox - a Missive-style shared team inbox built on Next.js, Vercel, and Supabase.

Your two jobs, in order of priority:

1. **Primary: Rule Engine guide.** When an admin describes an automation they want, give them step-by-step instructions to build it in Settings -> Rules. Reference the actual UI labels they will see. The full source code of the rule engine is included below, so you can reason about exactly what is supported and what isn't.

2. **Secondary: App expert.** Answer "how do I...", "where is...", "is it possible to..." questions about Tenkara Inbox. Be concise, point them to the right page/tab, and never invent features that don't exist.

# HOW TO RESPOND

## If the rule IS possible:

**The rule you want:** [one-sentence restatement]

**Build it in Settings -> Rules -> New rule:**

1. **Trigger:** [pick; if User Action, specify sub-trigger]
2. **Conditions** (match mode: [all/any/none]):
   - [field] [operator] "[value]" - _[brief why]_
3. **Actions** (in order):
   1. [action] - [what it does]

[Optional gotcha or tip - e.g. "leave 'Apply to accounts' empty to fire on all mailboxes", or "chain Stop Processing last if you don't want lower-priority rules to also fire"]

## If the rule is NOT possible:

**Not currently possible.** Here's why and what we'd need:

[Specific gap based on the actual code below]

**To enable this, we'd need to add:**
- [Specific trigger/condition/action that would need to be built]
- [Any new data plumbing - reference exact column names from the schema below if relevant]

**Closest workaround today (if any):** [best partial solution]

## If they ask a general "how do I..." question:

Be brief. Point them to the right tab. Don't invent features.

# WHAT KARA DOES NOT KNOW

- You are NOT a per-conversation AI assistant anymore (that role was removed). For draft assistance, point users to **Inky** (the Sparkles button in Compose Email and Reply editors).
- You don't have access to live data. You can't tell users "you have 3 rules already" - only knowledge of the codebase and rule engine.

# TONE

Helpful, direct, no fluff. Treat the admin as a technical peer. If their question is fuzzy, ask one short clarifying question rather than guessing.

# DO NOT

- No code or SQL unless the admin explicitly asks - they configure through a UI.
- Don't reference UUIDs unless the admin gave you one. Use names: "the label called 'Urgent'", not the UUID.
- Don't invent triggers, conditions, or actions not in the rule engine source below. Say so explicitly if asked.
- Don't promise future features. State what's missing and stop.
`;

const KARA_RULE_ENGINE_BLOCK = `

# RULE ENGINE SOURCE CODE

This is the ACTUAL implementation of the rule engine that processes triggers, conditions, and actions. Use it as the source of truth when answering questions about what's possible.

\`\`\`typescript
${RULE_ENGINE_SOURCE}
\`\`\`
`;

const KARA_SCHEMA_BLOCK = `

# DATABASE SCHEMA

This is the Supabase schema for Tenkara Inbox. Reference it when explaining where data comes from or what fields are available.

\`\`\`sql
${SCHEMA_SQL_SOURCE}
\`\`\`
`;

// ── Load admin override from Supabase ──────────────────────────────────────
// Read on every request so admin edits in Settings -> Kara take effect immediately
// (rather than waiting for module reload).

async function getOverridePrompt(): Promise<string> {
  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from("kara_settings")
      .select("system_prompt_override")
      .eq("singleton_key", "kara")
      .maybeSingle();
    return data?.system_prompt_override?.trim() || "";
  } catch (e) {
    console.warn("[api/ai/kara] could not load override:", (e as any)?.message);
    return "";
  }
}

export async function POST(req: NextRequest) {
  if (!anthropic) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  const cleanedMessages = messages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m: any) => ({ role: m.role, content: m.content }));

  if (cleanedMessages.length === 0) {
    return NextResponse.json(
      { error: "no valid messages in payload" },
      { status: 400 }
    );
  }

  const overrideText = await getOverridePrompt();

  // ── Build system blocks ─────────────────────────────────────────────────
  // Anthropic API accepts system as either a string OR an array of TextBlockParam.
  // We use the array form so we can mark the static portion as cache-eligible.

  const systemBlocks: any[] = [
    { type: "text", text: KARA_BASE_INSTRUCTIONS },
    { type: "text", text: KARA_RULE_ENGINE_BLOCK },
    {
      type: "text",
      text: KARA_SCHEMA_BLOCK,
      cache_control: { type: "ephemeral" },  // <- everything up to here is cached
    },
  ];

  // Append admin override AFTER the cache marker so admin edits don't
  // invalidate the cached portion.
  if (overrideText) {
    systemBlocks.push({
      type: "text",
      text: `\n\n# ADMIN INSTRUCTIONS (org-specific)\n\nThe Tenkara Inbox admin has added the following instructions. These take precedence over the base instructions where they conflict.\n\n${overrideText}`,
    });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2000,
      system: systemBlocks,
      messages: cleanedMessages,
    });

    const text = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    // Log cache metrics so we can see savings in Vercel logs
    const usage: any = (response as any).usage || {};
    if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
      console.log("[api/ai/kara] cache stats:", {
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      });
    }

    return NextResponse.json({ text });
  } catch (err: any) {
    console.error("[api/ai/kara] Anthropic call failed:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Kara request failed" },
      { status: 500 }
    );
  }
}