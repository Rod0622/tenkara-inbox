import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── System prompt ported from the Tenkara Missive integration tool ────────────
// Encodes Tenkara's identity (we ARE these brands, never address emails to ourselves),
// voice (warm, friendly, casual but professional), tone variations, and email code semantics.
const SYSTEM_PROMPT = `You are an AI email writing assistant for Tenkara - a company that sources specialty materials and ingredients for CPG brands.

## CRITICAL IDENTITY RULE:
- Tenkara, Bobber Labs, Rove Essentials, NutriPro Group, and PharmaLabs, LLC are US - they are the same company
- NEVER address emails TO any of our brands - we ARE these brands
- Emails should always be addressed to the SUPPLIER (external company)
- We send emails FROM Tenkara, Bobber Labs, Rove Essentials, NutriPro Group, or PharmaLabs, LLC - never TO them

## TENKARA VOICE:
- Warm, friendly, casual but professional
- Short sentences, conversational flow
- Phrases: "Thanks for...", "Great to hear...", "Would love to..."
- Direct asks without being pushy
- Excitement about products ("fun stuff", "cool projects")
- Personal touches ("I'd love to", "Let me know")
- Sign-off: "Thanks, [Organization]" or "Best, The [Organization] Team"
- Keep emails concise (3-8 sentences typically)

## TONE VARIATIONS:
- Warm: Friendly, appreciative, relationship-focused
- Casual: Relaxed, brief, conversational
- Direct: Clear, efficient, to the point
- Excited: Enthusiastic, energetic
- Professional: Polished but personable

## EMAIL CODE CONTEXT:
Email codes indicate workflow stages:
- E1: Initial material outreach
- E2: Existing supplier follow-ups
- E3: Classification-based outreach
- SUP/CLI: Supplier or Client communication
- SP/FV: Small Parcel or Freight
- ORD/NR/REC: Order, No Response, or Receiving

Return ONLY the email text, no explanations, no subject line, no greeting "Hi" preamble unless it's part of the body.`;

// Email code → human-readable workflow descriptions (for the prompt)
const EMAIL_CODE_DESCRIPTIONS: Record<string, string> = {
  "E1-INIT": "Initial outreach - do you carry this material?",
  "E1-FU-NR": "First follow-up after no response",
  "E1-FU-NR2": "Final follow-up before closing out",
  "E1-FU-INT1": "Supplier confirmed - request specs & pricing",
  "E1-FU-INT2": "Supplier asked questions - provide details",
  "E1-FU-INT3": "Supplier sent info proactively - acknowledge",
  "E1-FU-INT4": "Supplier confirmed with limitation",
  "E1-FU-INT5": "Requirements met - request quote",
  "E1-FU-INT6": "Partial info received - ask for rest",
  "E1-FU-INT7": "Cannot meet requirements - close out",
  "E1-FU-INT8": "Quote received - close out",
  "E2-INIT": "Existing supplier - docs/renewal request",
  "E2-FU-NR": "Follow-up (no response) to docs request",
  "E2-FU-INT1": "Complete docs received",
  "E2-FU-INT2": "Partial info - request correction",
  "E2-FU-INT3": "Supplier asked clarifying questions",
  "E2-FU-INT5": "All requirements met - close out",
  "E2-FU-INT7": "Cannot meet - close out",
  "E3-INIT": "Classification outreach",
  "E3-FU-NR": "Final follow-up",
  "E3-FU-INT1": "Doesn't have it - investigate alternatives",
  "E3-FU-INT3": "Something found - continue",
  "E3-FU-INT4": "Confirmed - request details",
  "E3-FU-INT8": "Requirements met - add to database",
  "E3-FU-INT10": "Cannot meet - close out",
  "E4-INIT": "Scraped supplier - request catalog",
  "E-MEET": "Supplier asks for meeting",
  "E-DIST": "Supplier redirects to distributor",
  "E-DOC1": "Supplier asks for docs first",
  "E-DOC2": "Follow-up with completed docs",
  "E-MISC": "Keep warm for future",
  "E1-SUP-SP-ORD1": "PO sent - confirm order, arrange pickup",
  "E1-SUP-SP-NR": "No PO acknowledgement follow-up",
  "E1-SUP-SP-ORD2": "Pickup coordination",
  "E1-SUP-SP-ORD3": "Shipment in transit",
  "E1-SUP-SP-ORD4": "Delivery confirmed",
  "E1-SUP-SP-ORD5": "Supplier delay",
  "E1-CLI-SP-ORD1": "Client order confirmation",
  "E1-SUP-FV-ORD1": "PO sent (freight)",
  "E1-SUP-FV-ORD2": "BOL - arrange shipping",
  "E1-SUP-FV-ORD3": "Pickup day coordination",
  "E1-SUP-FV-ORD4": "In transit - PRO number",
  "E1-SUP-FV-ORD5": "Delivery confirmed - POD",
  "E1-SUP-SP-HAZ1": "Hazmat order (small parcel)",
  "E1-SUP-FV-HAZ1": "Hazmat order (freight)",
  "E1-SUP-SP-REF1": "Reefer order (small parcel)",
  "E1-SUP-FV-REF1": "Reefer order (freight)",
  "E1-SUP-REC1": "Doc issue/mismatch complaint",
  "E1-SUP-REC2": "Material/packaging complaint",
  "E1-SUP-REC3": "Material accepted - close out",
  "E1-SUP-REC4": "Refund/replace confirmed",
  "E1-CLI-REC1": "Update client - no supplier response",
  "E1-CLI-REC2": "Update client - reached out",
  "E1-CLI-REC3": "Packaging damage",
  "E1-CLI-REC5": "Refund/replace outcome",
  "E1-CLI-REC6": "Material accepted",
};

const CODE_TO_PHASE: Record<string, number> = {
  "E1-INIT": 1, "E1-FU-NR": 1, "E1-FU-NR2": 1, "E1-FU-INT1": 1, "E1-FU-INT2": 1,
  "E1-FU-INT3": 1, "E1-FU-INT4": 1, "E1-FU-INT6": 1, "E1-FU-INT7": 1,
  "E2-INIT": 1, "E2-FU-NR": 1, "E2-FU-INT1": 1, "E2-FU-INT2": 1, "E2-FU-INT3": 1,
  "E2-FU-INT5": 1, "E2-FU-INT7": 1,
  "E3-INIT": 1, "E3-FU-NR": 1, "E3-FU-INT1": 1, "E3-FU-INT3": 1, "E3-FU-INT4": 1,
  "E3-FU-INT8": 1, "E3-FU-INT10": 1,
  "E4-INIT": 1, "E-MEET": 1, "E-DIST": 1, "E-DOC1": 1, "E-DOC2": 1, "E-MISC": 1,
  "E1-FU-INT5": 2, "E1-FU-INT8": 2,
  "E1-SUP-SP-ORD1": 3, "E1-SUP-SP-NR": 3, "E1-SUP-SP-ORD2": 3, "E1-SUP-SP-ORD3": 3,
  "E1-SUP-SP-ORD4": 3, "E1-SUP-SP-ORD5": 3, "E1-CLI-SP-ORD1": 3,
  "E1-SUP-FV-ORD1": 3, "E1-SUP-FV-ORD2": 3, "E1-SUP-FV-ORD3": 3, "E1-SUP-FV-ORD4": 3,
  "E1-SUP-FV-ORD5": 3, "E1-SUP-SP-HAZ1": 3, "E1-SUP-FV-HAZ1": 3, "E1-SUP-SP-REF1": 3,
  "E1-SUP-FV-REF1": 3,
  "E1-SUP-REC1": 4, "E1-SUP-REC2": 4, "E1-SUP-REC3": 4, "E1-SUP-REC4": 4,
  "E1-CLI-REC1": 4, "E1-CLI-REC2": 4, "E1-CLI-REC3": 4, "E1-CLI-REC5": 4, "E1-CLI-REC6": 4,
};

const PHASE_NAMES = ["", "RFQ / Outreach", "Quote", "Shipment", "Receiving"];

const MODIFIERS: Record<string, string> = {
  shorter: "\nMake it shorter and more concise.",
  longer: "\nAdd more detail and context.",
  different: "\nTry a completely different approach.",
  formal: "\nMake it more formal and professional.",
};

function truncate(s: string, max = 4000) {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n...[truncated]";
}

export async function POST(req: NextRequest) {
  if (!anthropic) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const organizationName: string = (body.organizationName || "Tenkara").toString().trim();
  const supplierCompany: string = (body.supplierCompany || "").toString().trim();
  const contactName: string = (body.contactName || "").toString().trim();
  const emailSubject: string = (body.emailSubject || "").toString().trim();
  const emailCode: string = (body.emailCode || "").toString().trim();
  const incomingMessage: string = (body.incomingMessage || "").toString().trim();
  const contextDescription: string = (body.contextDescription || "").toString().trim();
  const tone: string = (body.tone || "warm").toString().trim();
  const customTone: string = (body.customTone || "").toString().trim();
  const modifier: string = (body.modifier || "").toString().trim();

  if (!incomingMessage && !emailCode && !contextDescription) {
    return NextResponse.json(
      { error: "Provide at least one of: incoming message, email workflow code, or context description." },
      { status: 400 }
    );
  }

  // Build user prompt — same shape as the Missive tool
  let userPrompt = `Context:\n- Organization (FROM): ${organizationName}\n`;
  if (supplierCompany) userPrompt += `- Supplier (TO): ${supplierCompany}\n`;
  if (contactName) userPrompt += `- Contact: ${contactName}\n`;
  if (emailSubject) userPrompt += `- Subject: ${emailSubject}\n`;
  userPrompt += "\n";

  if (emailCode) {
    const phase = CODE_TO_PHASE[emailCode] || 0;
    const desc = EMAIL_CODE_DESCRIPTIONS[emailCode] || emailCode;
    userPrompt += `Email Code: ${emailCode}\nWorkflow: ${desc}\nPhase: ${PHASE_NAMES[phase] || "Unspecified"}\n\n`;
  }

  if (incomingMessage) {
    userPrompt += `Incoming message:\n"""\n${truncate(incomingMessage, 6000)}\n"""\n\n`;
  } else {
    userPrompt += "This is a proactive/outgoing email (no incoming message).\n\n";
  }

  if (contextDescription) userPrompt += `Additional context: ${contextDescription}\n\n`;

  const toneToUse = tone === "custom" && customTone ? customTone : tone;
  userPrompt += `Tone: ${toneToUse}\n`;

  if (modifier && MODIFIERS[modifier]) userPrompt += MODIFIERS[modifier];

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlocks = response.content.filter((c: any) => c.type === "text");
    const text = textBlocks.map((c: any) => c.text).join("").trim();

    if (!text) {
      return NextResponse.json({ error: "Empty response from model" }, { status: 502 });
    }

    return NextResponse.json({
      text,
      meta: {
        emailCode: emailCode || null,
        phase: emailCode ? PHASE_NAMES[CODE_TO_PHASE[emailCode] || 0] || null : null,
        tone: toneToUse,
        modifier: modifier || null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "AI generation failed" },
      { status: 500 }
    );
  }
}

// GET handler exposes the email code list to the client (no API key needed)
export async function GET() {
  const codes = Object.entries(EMAIL_CODE_DESCRIPTIONS).map(([code, description]) => ({
    code,
    description,
    phase: CODE_TO_PHASE[code] || 0,
    phase_name: PHASE_NAMES[CODE_TO_PHASE[code] || 0] || "",
  }));
  return NextResponse.json({ codes });
}
