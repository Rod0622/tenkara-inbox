import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function cleanText(value?: string | null) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string, max = 4000) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "\n...[truncated]";
}

// Attempt to recover a usable object from a possibly-truncated JSON string.
// Long multi-material extractions can exceed the output token budget and cut
// off mid-object/array. Rather than throw away the entire (otherwise excellent)
// extraction, we walk the string tracking structural depth and string state,
// drop any trailing incomplete token, and close open braces/brackets so the
// valid prefix parses. Returns null if nothing usable can be recovered.
function salvageJson(input: string): any | null {
  if (!input) return null;
  // Fast path: already valid.
  try {
    return JSON.parse(input);
  } catch {
    /* fall through to salvage */
  }

  // Walk the string tracking depth and string state. Record, at every point,
  // the index just after a closing brace/bracket together with the depth we
  // returned TO. This lets us truncate at the last complete element at ANY
  // depth (e.g. the last complete quote object inside the quotes array) and
  // then close the remaining open structures — instead of discarding a long
  // array just because it was cut off mid-element.
  let inString = false;
  let escaped = false;
  let depth = 0;
  let lastCloseIndex = -1; // index (exclusive) right after the last completed value

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      // A value just completed at this point; safe to truncate here and close.
      lastCloseIndex = i + 1;
    }
  }

  const candidates: string[] = [];

  // Candidate 1: truncate right after the last completed value, drop any
  // trailing comma, and close all still-open structures.
  if (lastCloseIndex > 0) {
    const head = input.slice(0, lastCloseIndex).replace(/,\s*$/, "");
    const closers = computeOpenClosers(head);
    if (closers !== null) candidates.push(head + closers);
  }

  // Candidate 2: drop an obviously-partial trailing key/value, then close.
  {
    let head = input
      .replace(/,\s*"[^"]*"\s*:\s*("[^"]*)?$/, "")
      .replace(/,\s*$/, "");
    const closers = computeOpenClosers(head);
    if (closers !== null && closers.length > 0) candidates.push(head + closers);
  }

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return null;
}

// Given a JSON prefix, return the string of closing brackets/braces needed to
// balance it (ignoring brackets inside strings). Returns null if the prefix
// ends inside an unterminated string (cannot be safely closed).
function computeOpenClosers(prefix: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  // If we ended inside a string, we can't safely close — signal no recovery.
  if (inString) return null;
  return stack.reverse().join("");
}

// ── Auto-promote extracted supplier info + quotes into the persistent,
// editable supplier_profiles / supplier_quotes tables (Step 4 / model "Y").
// Rules:
//   • Profile: FILL-ONLY-IF-EMPTY — write an extracted field only when the
//     saved profile's field is currently blank. Never overwrites existing or
//     human-edited values.
//   • Quotes: INSERT-IF-NOT-EXISTS keyed on (supplier_contact_id, material_name,
//     source_conversation_id). If a row for that material+thread already exists
//     (possibly human-edited), leave it untouched.
// Best-effort: any failure here must NOT break the summary response.
const PROMOTE_PROFILE_FIELDS = [
  "type",
  "pickup_address",
  "website",
  "purchasing_thresholds",
  "shipping_terms",
  "shipping_email",
  "billing_email",
  "acc_hazmat_handling_rate",
  "acc_temperature_controlled_rate",
  "acc_liftgate_service_rate",
  "acc_special_packaging_rate",
  "acc_other",
  "payment_method",
  "payment_details",
  "payment_terms_type",
  "payment_terms_details",
  "facility_certifications",
  "other_notes",
];

// Map the extracted supplier_information object onto the flat profile columns.
function mapExtractedProfile(si: any): Record<string, any> {
  if (!si || typeof si !== "object") return {};
  const acc = si.accessorial_charges || {};
  const payInfo = si.payment_information || {};
  const payTerms = si.payment_terms || {};
  return {
    type: si.type && si.type !== "unknown" ? si.type : null,
    pickup_address: si.pickup_address,
    website: si.website,
    purchasing_thresholds: si.purchasing_thresholds,
    shipping_terms: si.shipping_terms,
    shipping_email: si.shipping_email,
    billing_email: si.billing_email,
    acc_hazmat_handling_rate: acc.hazmat_handling_rate,
    acc_temperature_controlled_rate: acc.temperature_controlled_storage_rate,
    acc_liftgate_service_rate: acc.liftgate_service_rate,
    acc_special_packaging_rate: acc.special_packaging_rate,
    acc_other: acc.other,
    payment_method: payInfo.method,
    payment_details: payInfo.details,
    payment_terms_type: payTerms.type,
    payment_terms_details: payTerms.details,
    facility_certifications: si.facility_certifications_compliances,
    other_notes: si.other_notes,
  };
}

// Parse a best-effort lowest/base numeric price from the extracted price string.
function parsePriceNumeric(price: any): number | null {
  if (price === null || price === undefined) return null;
  const s = String(price);
  const matches = s.match(/[0-9]+(?:\.[0-9]+)?/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map((m) => parseFloat(m)).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

async function autoPromoteToSupplierProfile(
  supabase: any,
  conversation: any,
  parsed: any,
  actorId: string | null
): Promise<void> {
  try {
    // Resolve the supplier this thread belongs to.
    let supplierContactId: string | null = conversation.supplier_contact_id || null;
    if (!supplierContactId && conversation.from_email) {
      const { data: sc } = await supabase
        .from("supplier_contacts")
        .select("id")
        .eq("email", String(conversation.from_email).trim().toLowerCase())
        .maybeSingle();
      supplierContactId = sc?.id || null;
    }
    if (!supplierContactId) return; // not a supplier thread — nothing to promote

    // ── Profile: fill-only-if-empty ──
    const extracted = mapExtractedProfile(coerceSupplierInformation(parsed.supplier_information));
    const { data: existingProfile } = await supabase
      .from("supplier_profiles")
      .select("*")
      .eq("supplier_contact_id", supplierContactId)
      .maybeSingle();

    const profileUpdate: Record<string, any> = {};
    for (const f of PROMOTE_PROFILE_FIELDS) {
      const incoming = extracted[f];
      const hasIncoming = incoming !== null && incoming !== undefined && incoming !== "";
      const existingVal = existingProfile ? existingProfile[f] : null;
      const existingEmpty = existingVal === null || existingVal === undefined || existingVal === "";
      if (hasIncoming && existingEmpty) profileUpdate[f] = incoming;
    }
    if (Object.keys(profileUpdate).length > 0 || !existingProfile) {
      await supabase
        .from("supplier_profiles")
        .upsert(
          { supplier_contact_id: supplierContactId, updated_by: actorId, ...profileUpdate },
          { onConflict: "supplier_contact_id" }
        );
    }

    // ── Quotes: insert new, and FILL-ONLY-IF-EMPTY on existing rows ──
    // Keyed per (supplier, material, thread). New materials are inserted. For a
    // material already promoted from this thread, we fill in any columns that
    // are currently null/empty with freshly-extracted values, but never
    // overwrite a non-empty (possibly human-edited) value. This lets a later,
    // better extraction backfill fields (e.g. prices) that an earlier run missed.
    const quotes = coerceQuotes(parsed.quotes);
    if (quotes.length > 0) {
      const { data: existingQuotes } = await supabase
        .from("supplier_quotes")
        .select("*")
        .eq("supplier_contact_id", supplierContactId)
        .eq("source_conversation_id", conversation.id);
      const existingByName = new Map<string, any>(
        (existingQuotes || []).map((q: any) => [String(q.material_name || "").trim().toLowerCase(), q])
      );

      // Columns we never auto-fill (identity / bookkeeping).
      const FILL_SKIP = new Set([
        "id",
        "supplier_contact_id",
        "source_conversation_id",
        "material_name",
        "created_by",
        "created_at",
        "updated_at",
      ]);

      const isEmpty = (v: any) => v === null || v === undefined || v === "";

      const newRows: any[] = [];
      for (const q of quotes) {
        const name = String(q.material_name || "").trim();
        if (!name) continue; // material_name is required

        const extractedCols: Record<string, any> = {
          inci_trade_name: q.inci_trade_name,
          grade: q.grade,
          price_raw: q.price,
          price_numeric: parsePriceNumeric(q.price),
          price_qty: q.price_qty,
          price_unit: q.price_unit,
          case_width: q.case_width,
          case_height: q.case_height,
          case_length: q.case_length,
          // case/weight/pack consolidated into one field; stored in pack_size.
          pack_size: q.case_pack_size,
          quote_provided_date: q.quote_provided_date,
          quote_expiry: q.quote_expiry,
          lead_time: q.lead_time,
          moq: q.moq,
          max_inventory: q.max_inventory,
          hazardous: q.hazardous,
          refrigerated: q.refrigerated,
          equipment_accessorials: q.equipment_accessorials,
          material_id: q.material_id,
          doc_coa: q.docs_supplied?.coa === true,
          doc_sds: q.docs_supplied?.sds === true,
          doc_tds: q.docs_supplied?.tds === true,
          sample_handling: q.sample_handling,
          other_notes: q.other_notes,
        };

        const existing = existingByName.get(name.toLowerCase());
        if (!existing) {
          // New material from this thread → insert full row.
          newRows.push({
            supplier_contact_id: supplierContactId,
            source_conversation_id: conversation.id,
            created_by: actorId,
            material_name: name,
            ...extractedCols,
          });
        } else {
          // Existing row → fill only the columns that are currently empty.
          // Booleans for docs are treated as "fillable" only when the existing
          // value is false AND the extraction says true (so a doc that becomes
          // available gets recorded, but an explicit edit to false is kept only
          // if the extraction also has nothing to add).
          const fill: Record<string, any> = {};
          for (const [col, val] of Object.entries(extractedCols)) {
            if (FILL_SKIP.has(col)) continue;
            if (col === "doc_coa" || col === "doc_sds" || col === "doc_tds") {
              if (existing[col] !== true && val === true) fill[col] = true;
              continue;
            }
            if (isEmpty(existing[col]) && !isEmpty(val)) fill[col] = val;
          }
          if (Object.keys(fill).length > 0) {
            await supabase.from("supplier_quotes").update(fill).eq("id", existing.id);
          }
        }
      }
      if (newRows.length > 0) {
        await supabase.from("supplier_quotes").insert(newRows);
      }
    }
  } catch (e: any) {
    // Best-effort: never break the summary because promotion failed.
    console.error("[thread-summary] auto-promote failed:", e?.message || e);
  }
}

// Coerce a value to a trimmed string or null (no guessing, no defaults).
function strOrNull(v: any): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

// Coerce a value to boolean or null (unknown stays null).
function boolOrNull(v: any): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["yes", "y", "true"].includes(t)) return true;
    if (["no", "n", "false"].includes(t)) return false;
  }
  return null;
}

// Defensive coercion of the supplier_information block to a known shape.
const ALLOWED_SUPPLIER_TYPES = ["distributor", "direct_manufacturer", "broker", "unknown"];
function coerceSupplierInformation(si: any) {
  const obj = si && typeof si === "object" ? si : {};
  const acc = obj.accessorial_charges && typeof obj.accessorial_charges === "object" ? obj.accessorial_charges : {};
  const payInfo = obj.payment_information && typeof obj.payment_information === "object" ? obj.payment_information : {};
  const payTerms = obj.payment_terms && typeof obj.payment_terms === "object" ? obj.payment_terms : {};
  const rawType = strOrNull(obj.type);
  const type = rawType && ALLOWED_SUPPLIER_TYPES.includes(rawType.toLowerCase()) ? rawType.toLowerCase() : "unknown";
  return {
    type,
    pickup_address: strOrNull(obj.pickup_address),
    contact_name: strOrNull(obj.contact_name),
    contact_email: strOrNull(obj.contact_email),
    contact_phone: strOrNull(obj.contact_phone),
    additional_contacts: strOrNull(obj.additional_contacts),
    website: strOrNull(obj.website),
    purchasing_thresholds: strOrNull(obj.purchasing_thresholds),
    shipping_terms: strOrNull(obj.shipping_terms),
    shipping_email: strOrNull(obj.shipping_email),
    billing_email: strOrNull(obj.billing_email),
    accessorial_charges: {
      hazmat_handling_rate: strOrNull(acc.hazmat_handling_rate),
      temperature_controlled_storage_rate: strOrNull(acc.temperature_controlled_storage_rate),
      liftgate_service_rate: strOrNull(acc.liftgate_service_rate),
      special_packaging_rate: strOrNull(acc.special_packaging_rate),
      other: strOrNull(acc.other),
    },
    payment_information: {
      method: strOrNull(payInfo.method),
      details: strOrNull(payInfo.details),
    },
    payment_terms: {
      type: strOrNull(payTerms.type),
      details: strOrNull(payTerms.details),
    },
    facility_certifications_compliances: strOrNull(obj.facility_certifications_compliances),
    other_notes: strOrNull(obj.other_notes),
  };
}

// Defensive coercion of the quotes array — one object per material.
function coerceQuotes(quotes: any) {
  if (!Array.isArray(quotes)) return [];
  return quotes.map((q: any) => {
    const obj = q && typeof q === "object" ? q : {};
    const docs = obj.docs_supplied && typeof obj.docs_supplied === "object" ? obj.docs_supplied : {};
    return {
      material_name: strOrNull(obj.material_name),
      inci_trade_name: strOrNull(obj.inci_trade_name),
      grade: strOrNull(obj.grade),
      price: strOrNull(obj.price),
      price_qty: strOrNull(obj.price_qty),
      price_unit: strOrNull(obj.price_unit),
      case_width: strOrNull(obj.case_width),
      case_height: strOrNull(obj.case_height),
      case_length: strOrNull(obj.case_length),
      case_pack_size: strOrNull(obj.case_pack_size),
      quote_provided_date: strOrNull(obj.quote_provided_date),
      quote_expiry: strOrNull(obj.quote_expiry),
      lead_time: strOrNull(obj.lead_time),
      moq: strOrNull(obj.moq),
      max_inventory: strOrNull(obj.max_inventory),
      hazardous: boolOrNull(obj.hazardous),
      refrigerated: boolOrNull(obj.refrigerated),
      equipment_accessorials: strOrNull(obj.equipment_accessorials),
      material_id: strOrNull(obj.material_id),
      docs_supplied: {
        coa: boolOrNull(docs.coa) === true,
        sds: boolOrNull(docs.sds) === true,
        tds: boolOrNull(docs.tds) === true,
      },
      sample_handling: strOrNull(obj.sample_handling),
      other_notes: strOrNull(obj.other_notes),
    };
  });
}

function buildPrompt(params: {
  subject: string;
  fromName?: string | null;
  fromEmail?: string | null;
  messages: Array<{
    from_name?: string | null;
    from_email?: string | null;
    to_addresses?: string | null;
    body_text?: string | null;
    snippet?: string | null;
    sent_at?: string | null;
  }>;
  notes: Array<{ text?: string | null }>;
  tasks: Array<{ text?: string | null; status?: string | null; is_done?: boolean }>;
}) {
  const messagesText = params.messages
    .slice(-12)
    .map((msg, idx) => {
      const body = cleanText(msg.body_text || msg.snippet || "");
      return [
        `Message ${idx + 1}`,
        `From: ${msg.from_name || ""} <${msg.from_email || ""}>`,
        `To: ${msg.to_addresses || ""}`,
        `Sent: ${msg.sent_at || ""}`,
        `Content:\n${truncate(body, 2500)}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const notesText =
    params.notes.length > 0
      ? params.notes.map((n, i) => `${i + 1}. ${cleanText(n.text || "")}`).join("\n")
      : "None";

  const tasksText =
    params.tasks.length > 0
      ? params.tasks
          .map((t, i) => {
            const done = t.status === "completed" || t.is_done;
            return `${i + 1}. [${done ? "completed" : "open"}] ${cleanText(t.text || "")}`;
          })
          .join("\n")
      : "None";

  return `
You are summarizing one operational email thread for a shared inbox.

Return ONLY valid JSON with this exact shape:
{
  "overview": "short paragraph",
  "status": "one short status label",
  "intent": "primary intent label",
  "confidence": "low | medium | high",
  "secondary_intents": ["intent 1", "intent 2"],
  "open_action_items": ["item 1", "item 2"],
  "completed_items": ["item 1", "item 2"],
  "suggested_tasks": ["task 1", "task 2"],
  "next_step": "single best next step",
  "supplier_information": {
    "type": "distributor | direct_manufacturer | broker | unknown",
    "pickup_address": null,
    "contact_name": null,
    "contact_email": null,
    "contact_phone": null,
    "additional_contacts": null,
    "website": null,
    "purchasing_thresholds": null,
    "shipping_terms": null,
    "shipping_email": null,
    "billing_email": null,
    "accessorial_charges": {
      "hazmat_handling_rate": null,
      "temperature_controlled_storage_rate": null,
      "liftgate_service_rate": null,
      "special_packaging_rate": null,
      "other": null
    },
    "payment_information": { "method": null, "details": null },
    "payment_terms": { "type": null, "details": null },
    "facility_certifications_compliances": null,
    "other_notes": null
  },
  "quotes": [
    {
      "material_name": null,
      "inci_trade_name": null,
      "grade": null,
      "price": null,
      "price_qty": null,
      "price_unit": null,
      "case_width": null,
      "case_height": null,
      "case_length": null,
      "case_pack_size": null,
      "quote_provided_date": null,
      "quote_expiry": null,
      "lead_time": null,
      "moq": null,
      "max_inventory": null,
      "hazardous": null,
      "refrigerated": null,
      "equipment_accessorials": null,
      "material_id": null,
      "docs_supplied": { "coa": false, "sds": false, "tds": false },
      "sample_handling": null,
      "other_notes": null
    }
  ]
}

Rules:
- Be concise and operational.
- Use only facts supported by the thread, notes, and tasks.
- If something is uncertain, keep it out.
- Open action items should be things still needing action.
- Completed items should be clearly done.
- Suggested tasks should be practical internal follow-up tasks, not duplicates of clearly completed work.
- "status" should be short, like:
  "waiting for supplier"
  "waiting for internal decision"
  "quote received"
  "ready to reply"
  "in progress"

Supplier information & quotes extraction rules (IMPORTANT):
- Extract supplier_information and quotes ONLY from facts explicitly stated in the thread, notes, or tasks.
- NEVER guess, infer, or fill any field from general knowledge. If a field is not explicitly stated, use null (for booleans use null when unknown, not false).
- Do not invent addresses, emails, phone numbers, prices, certifications, or terms. A blank/null is correct and expected when the thread does not state it.
- "type" must be one of: distributor, direct_manufacturer, broker, unknown. Use "unknown" unless the thread clearly indicates which.
- "quotes" is an array with ONE object per distinct material/product quoted in the thread. If no quote/pricing appears in the thread, return an empty array [].
- For each quote: "quote_provided_date" = the date the supplier actually provided/sent this quote or price (use the message date if the price is stated in that message). "quote_expiry" = the date or duration the quote is stated to remain valid until (e.g. "valid for 30 days", "expires 2026-07-01"). These are different fields — fill each only if supported.
- For docs_supplied, set coa/sds/tds to true only if the thread indicates that document was provided or offered; otherwise false.
- For prices, put the numeric/text price in "price", the quantity it applies to in "price_qty", and the unit in "price_unit" (e.g. price "12.50", price_qty "1", price_unit "kg").
- "case_pack_size" is a SINGLE combined field for case/pack size, case weight, and pack size — capture whatever the supplier states about packaging size/weight here, together (e.g. "25kg fiber drum" or "1kg aluminum foil bag, 25 units/case"). Do not split these out.
- "lead_time": if the supplier indicates the material is in stock / ready stock / available now / ships immediately, reflect that in lead_time (e.g. "In stock"). If they give both an in-stock note and a shipping time, capture both (e.g. "In stock — ships in 3 days"). If only a time is given, use that.

Thread subject: ${params.subject}
Conversation from: ${params.fromName || ""} <${params.fromEmail || ""}>

Notes:
${notesText}

Tasks:
${tasksText}

Messages:
${messagesText}
`.trim();
}

export async function GET(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    if (!session?.teamMember) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();
    const conversationId = req.nextUrl.searchParams.get("conversation_id");

    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("thread_summaries")
      .select("*")
      .eq("conversation_id", conversationId)
      .single();

    if (error && error.code !== "PGRST116") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ summary: data || null });
  } catch (error: any) {
    console.error("GET /api/ai/thread-summary failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch summary" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    if (!session?.teamMember) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!anthropic) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const supabase = createServerClient();
    const body = await req.json();
    const conversationId = body.conversation_id;
    const forceRefresh = Boolean(body.force_refresh);

    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
    }

    const { data: conversation, error: convoError } = await supabase
      .from("conversations")
      .select("id, subject, from_name, from_email, last_message_at, supplier_contact_id")
      .eq("id", conversationId)
      .single();

    if (convoError || !conversation) {
      return NextResponse.json(
        { error: convoError?.message || "Conversation not found" },
        { status: 404 }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("from_name, from_email, to_addresses, body_text, snippet, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json({ error: messagesError.message }, { status: 500 });
    }

    const { data: notes, error: notesError } = await supabase
      .from("notes")
      .select("text")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (notesError) {
      return NextResponse.json({ error: notesError.message }, { status: 500 });
    }

    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("text, status, is_done")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (tasksError) {
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    const messageCount = (messages || []).length;
    const noteCount = (notes || []).length;
    const taskCount = (tasks || []).length;
    const completedTaskCount = (tasks || []).filter(
      (task) => task.status === "completed" || task.is_done
    ).length;

    if (!forceRefresh) {
      const { data: existing } = await supabase
        .from("thread_summaries")
        .select("*")
        .eq("conversation_id", conversationId)
        .single();

      if (
        existing &&
        existing.source_message_count === messageCount &&
        existing.source_note_count === noteCount &&
        existing.source_task_count === taskCount &&
        existing.source_completed_task_count === completedTaskCount &&
        String(existing.last_message_at || "") === String(conversation.last_message_at || "")
      ) {
        return NextResponse.json({ summary: existing, cached: true });
      }
    }

    const prompt = buildPrompt({
      subject: conversation.subject || "(No subject)",
      fromName: conversation.from_name,
      fromEmail: conversation.from_email,
      messages: messages || [],
      notes: notes || [],
      tasks: tasks || [],
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text)
      .join("\n")
      .trim();

    // Strip markdown code fences if present
    const text = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    const wasTruncated = response.stop_reason === "max_tokens";

    let parsed: any = salvageJson(text);

    // Diagnostics: surface truncation and how many quotes survived parsing.
    // A large multi-material thread that hits the token cap will salvage only
    // the complete quotes, which can be fewer than the model started emitting.
    if (wasTruncated) {
      const recovered = Array.isArray(parsed?.quotes) ? parsed.quotes.length : 0;
      console.warn(
        `[thread-summary] response hit max_tokens (truncated) for conversation ${conversationId}; ` +
          `recovered ${recovered} quote(s) after salvage. Thread may need chunked extraction.`
      );
    }

    if (!parsed || typeof parsed !== "object") {
      // Could not recover anything usable. Rather than wipe a previously-good
      // summary, return the existing cached one (if any) so the UI still shows
      // something, and signal the failure for diagnostics.
      const { data: existingOnFail } = await supabase
        .from("thread_summaries")
        .select("*")
        .eq("conversation_id", conversationId)
        .maybeSingle();

      if (existingOnFail) {
        return NextResponse.json({
          summary: existingOnFail,
          cached: true,
          warning: "Model output could not be parsed; showing previous summary.",
        });
      }
      return NextResponse.json(
        { error: "Model returned invalid JSON", truncated: wasTruncated, raw: rawText.slice(0, 2000) },
        { status: 500 }
      );
    }

    const payload = {
      conversation_id: conversationId,
      summary: {
        overview: typeof parsed.overview === "string" ? parsed.overview : "",
        status: typeof parsed.status === "string" ? parsed.status : "",
        intent: typeof parsed.intent === "string" ? parsed.intent : "general_inquiry",
        confidence: typeof parsed.confidence === "string" ? parsed.confidence : "medium",
        secondary_intents: Array.isArray(parsed.secondary_intents)
          ? parsed.secondary_intents
          : [],
        open_action_items: Array.isArray(parsed.open_action_items)
          ? parsed.open_action_items
          : [],
        completed_items: Array.isArray(parsed.completed_items)
          ? parsed.completed_items
          : [],
        suggested_tasks: Array.isArray(parsed.suggested_tasks)
          ? parsed.suggested_tasks
          : [],
        next_step: typeof parsed.next_step === "string" ? parsed.next_step : "",
        supplier_information: coerceSupplierInformation(parsed.supplier_information),
        quotes: coerceQuotes(parsed.quotes),
      },
      source_message_count: messageCount,
      source_note_count: noteCount,
      source_task_count: taskCount,
      source_completed_task_count: completedTaskCount,
      last_message_at: conversation.last_message_at || null,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveError } = await supabase
      .from("thread_summaries")
      .upsert(payload, { onConflict: "conversation_id" })
      .select("*")
      .single();

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    // Auto-promote the extracted supplier info + quotes into the persistent,
    // editable supplier_profiles / supplier_quotes tables. Awaited (so it
    // completes before the serverless function returns) but best-effort —
    // it never throws back into the response.
    await autoPromoteToSupplierProfile(supabase, conversation, parsed, session.teamMember.id || null);

    return NextResponse.json({ summary: saved, cached: false, truncated: wasTruncated });
  } catch (error: any) {
    console.error("POST /api/ai/thread-summary failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate summary" },
      { status: 500 }
    );
  }
}