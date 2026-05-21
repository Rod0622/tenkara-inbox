// src/app/api/suppliers/search/route.ts
//
// GET /api/suppliers/search?q=<query>&limit=10
//
// Returns suppliers matching the query, plus per-supplier:
//   - open_conversation_count : int
//   - most_recent_open_conversation_id : uuid | null
//   - primary_contact_person : { id, name, phone } | null  (best phone match)
//
// Used by QuickCallModal's autocomplete (and reusable elsewhere). Empty `q`
// returns the top N suppliers by most-recently-touched.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limitParam = parseInt(url.searchParams.get("limit") || "10", 10);
  const limit = Math.min(Math.max(limitParam, 1), 50);

  const supabase = createServerClient();

  // Step 1 — find matching suppliers. Match on name or company (whichever exists)
  let sq = supabase
    .from("supplier_contacts")
    .select("id, name, email, company, last_exchange_at")
    .order("last_exchange_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (q) {
    // Fuzzy match: name OR company ILIKE %q%
    sq = sq.or(`name.ilike.%${q}%,company.ilike.%${q}%`);
  }

  const { data: suppliers, error: sErr } = await sq;
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }
  const supplierRows = (suppliers || []) as any[];
  if (supplierRows.length === 0) {
    return NextResponse.json({ suppliers: [] });
  }

  const supplierIds = supplierRows.map((s) => s.id);

  // Step 2 — for each, count open conversations + pick most recent
  const { data: openConvos } = await supabase
    .from("conversations")
    .select("id, supplier_contact_id, last_message_at")
    .in("supplier_contact_id", supplierIds)
    .eq("status", "open")
    .order("last_message_at", { ascending: false });

  const convoCount: Record<string, number> = {};
  const mostRecentConvo: Record<string, string> = {};
  for (const c of (openConvos || []) as any[]) {
    const sid = c.supplier_contact_id;
    convoCount[sid] = (convoCount[sid] || 0) + 1;
    if (!mostRecentConvo[sid]) mostRecentConvo[sid] = c.id; // first = most recent due to ordering
  }

  // Step 3 — find a "primary contact person" per supplier (one with phone, prefer first by sort_order)
  const { data: persons } = await supabase
    .from("supplier_contact_persons")
    .select("id, name, phone, supplier_contact_id, sort_order")
    .in("supplier_contact_id", supplierIds)
    .not("phone", "is", null)
    .order("sort_order", { ascending: true });

  const primaryPerson: Record<string, any> = {};
  for (const p of (persons || []) as any[]) {
    if (!primaryPerson[p.supplier_contact_id]) {
      primaryPerson[p.supplier_contact_id] = {
        id: p.id,
        name: p.name,
        phone: p.phone,
      };
    }
  }

  // Step 4 — assemble result
  const result = supplierRows.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    company: s.company,
    last_exchange_at: s.last_exchange_at,
    open_conversation_count: convoCount[s.id] || 0,
    most_recent_open_conversation_id: mostRecentConvo[s.id] || null,
    primary_contact_person: primaryPerson[s.id] || null,
  }));

  return NextResponse.json({ suppliers: result });
}
