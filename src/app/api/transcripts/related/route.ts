export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── Related Transcripts API ────────────────────────────────────────────────
//
// Given a Tenkara conversation_id, find Granola transcripts that likely
// relate to the same supplier.
//
// Matching strategy (in order of confidence):
//   1. Conversation has supplier_contact_id → fetch supplier name → ILIKE
//      match on transcript supplier_name OR participants
//   2. No supplier link → match on the conversation's from_email or from_name
//      against transcript participants
//
// Both ILIKE matches are permissive — a transcript title or participant
// containing the supplier name (even partially) counts as a match. Not
// perfect, but useful as a discovery surface. Users see a confidence
// indicator and can dismiss false positives mentally.
//
// RBAC: applies the same dashboard_users lookup as /api/transcripts.

const PROTOTYPE_SCHEMA = "prototype" as any;

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversation_id");
  const userEmail = (searchParams.get("user_email") || "").toLowerCase();

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }
  if (!userEmail) {
    return NextResponse.json({ error: "user_email required" }, { status: 400 });
  }

  // RBAC lookup
  let userDepartment = "Operations";
  let userRole = "member";
  try {
    const { data: user } = await (supabase as any)
      .schema(PROTOTYPE_SCHEMA)
      .from("dashboard_users")
      .select("role, department")
      .eq("email", userEmail)
      .maybeSingle();
    if (user) {
      userRole = user.role || "member";
      userDepartment = user.department || "Operations";
    }
  } catch (_e) {}
  const isOperationsRestricted = userRole !== "admin" && userDepartment === "Operations";

  // Get the conversation's supplier info
  const { data: convo, error: cErr } = await supabase
    .from("conversations")
    .select("supplier_contact_id, from_name, from_email, subject")
    .eq("id", conversationId)
    .maybeSingle();

  if (cErr || !convo) {
    return NextResponse.json({ matches: [] });
  }

  // Resolve supplier name (preferred match target)
  let supplierName: string | null = null;
  if (convo.supplier_contact_id) {
    const { data: supp } = await supabase
      .from("supplier_contacts")
      .select("name")
      .eq("id", convo.supplier_contact_id)
      .maybeSingle();
    supplierName = supp?.name || null;
  }

  // Build the OR clauses for ILIKE matching. We try supplier name first,
  // then fall back to from_name/from_email if no supplier link.
  const candidates: string[] = [];
  const addCandidate = (s: string | null | undefined) => {
    if (!s) return;
    const trimmed = s.trim();
    // Skip too-short or generic terms that would over-match.
    if (trimmed.length < 3) return;
    // Skip personal-email domains (gmail, outlook, etc.) — likely noise.
    if (/@(gmail|outlook|hotmail|yahoo|aol|icloud|proton)\./i.test(trimmed)) return;
    candidates.push(trimmed.replace(/[%,]/g, " "));
  };
  addCandidate(supplierName);
  if (!supplierName) {
    // Fall back to from_name (e.g. "Acme Foods") and the local part of the
    // email domain (e.g. "acmefoods" from "purchasing@acmefoods.com").
    addCandidate(convo.from_name);
    if (convo.from_email && convo.from_email.includes("@")) {
      const domain = convo.from_email.split("@")[1] || "";
      const company = domain.split(".")[0] || "";
      addCandidate(company);
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ matches: [] });
  }

  // Build ILIKE OR query across supplier_name + participants for each candidate.
  const orParts: string[] = [];
  for (const c of candidates) {
    orParts.push(`supplier_name.ilike.%${c}%`);
    orParts.push(`participants.ilike.%${c}%`);
  }

  let query = (supabase as any)
    .schema(PROTOTYPE_SCHEMA)
    .from("call_transcripts")
    .select("id, supplier_name, call_date, call_type, department, participants, summary, transcript_link")
    .or(orParts.join(","))
    .order("call_date", { ascending: false })
    .limit(20);

  if (isOperationsRestricted) {
    query = query.eq("department", "Operations");
  }

  const { data, error } = await query;
  if (error) {
    console.error("[related-transcripts]", error.message);
    return NextResponse.json({ matches: [] });
  }

  return NextResponse.json({
    matches: data || [],
    matched_on: supplierName ? "supplier_name" : "from_email_or_name",
    supplier_name: supplierName,
  });
}
