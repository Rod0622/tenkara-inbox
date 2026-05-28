export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── Granola Transcripts API (Tenkara side) ──────────────────────────────────
//
// Reads from prototype.call_transcripts. This is the cross-schema integration
// with the Granola Sync project that lives in the same Supabase project but
// the `prototype` schema.
//
// Auth/RBAC: Tenkara users get synced into prototype.dashboard_users via a
// DB trigger (see schema migration). The mapping:
//   Tenkara admin → Granola admin (department='Management') — sees all
//   Tenkara member → Granola member (department='Operations') — restricted
//                                                                to Operations
// For Tenkara purposes, the RBAC mirrors Granola Sync's original semantics.
//
// Endpoints:
//   GET ?user_email=X&q=Y&from=&to=&department=  → list with RBAC
//   GET ?user_email=X&id=Z                       → single transcript detail

const PROTOTYPE_SCHEMA = "prototype" as any;

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const userEmail = (searchParams.get("user_email") || "").toLowerCase();
  const q = (searchParams.get("q") || "").trim();
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const deptFilter = searchParams.get("department") || "";

  if (!userEmail) {
    return NextResponse.json({ error: "user_email required" }, { status: 400 });
  }

  // Look up the user's role + department in dashboard_users to enforce RBAC.
  // The DB trigger keeps this in sync with Tenkara's team_members.
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
  } catch (e: any) {
    console.error("[transcripts] dashboard_users lookup failed:", e?.message);
  }

  // Single transcript detail
  if (id) {
    const { data, error } = await (supabase as any)
      .schema(PROTOTYPE_SCHEMA)
      .from("call_transcripts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // RBAC: Operations-restricted members can only see Operations transcripts
    const isOperationsRestricted = userRole !== "admin" && userDepartment === "Operations";
    if (isOperationsRestricted && data.department !== "Operations") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ transcript: data });
  }

  // List
  let query = (supabase as any)
    .schema(PROTOTYPE_SCHEMA)
    .from("call_transcripts")
    .select("id, supplier_name, call_date, call_type, category, department, participants, summary, action_items, transcript_link, transcript_status")
    .order("call_date", { ascending: false })
    .limit(200);

  // RBAC filter: Operations members see only Operations transcripts
  const isOperationsRestricted = userRole !== "admin" && userDepartment === "Operations";
  if (isOperationsRestricted) {
    query = query.eq("department", "Operations");
  } else if (deptFilter) {
    // Admins / non-Operations can filter by department
    query = query.eq("department", deptFilter);
  }

  // Search across supplier_name, participants, summary, transcript_text.
  // Using comma-separated or() with ilike. PostgREST handles this fine.
  if (q) {
    const safe = q.replace(/[%,]/g, " ");
    query = query.or(
      `supplier_name.ilike.%${safe}%,participants.ilike.%${safe}%,summary.ilike.%${safe}%,transcript_text.ilike.%${safe}%`
    );
  }

  if (from) query = query.gte("call_date", from);
  if (to) query = query.lte("call_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    transcripts: data || [],
    user_role: userRole,
    user_department: userDepartment,
  });
}
