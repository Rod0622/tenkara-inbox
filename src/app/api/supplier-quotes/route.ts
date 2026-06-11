import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Columns the client may write on a quote (everything except ids/timestamps).
const QUOTE_FIELDS = [
  "material_name",
  "inci_trade_name",
  "grade",
  "price_raw",
  "price_numeric",
  "price_qty",
  "price_unit",
  "case_width",
  "case_height",
  "case_length",
  "case_weight",
  "case_size",
  "pack_size",
  "quote_provided_date",
  "quote_expiry",
  "lead_time",
  "moq",
  "max_inventory",
  "hazardous",
  "refrigerated",
  "equipment_accessorials",
  "material_id",
  "doc_coa",
  "doc_sds",
  "doc_tds",
  "sample_handling",
  "other_notes",
];

const BOOL_FIELDS = new Set(["hazardous", "refrigerated", "doc_coa", "doc_sds", "doc_tds"]);

function cleanField(field: string, v: any): any {
  if (BOOL_FIELDS.has(field)) {
    if (v === true || v === false) return v;
    if (v === null || v === undefined || v === "") return field.startsWith("doc_") ? false : null;
    return Boolean(v);
  }
  if (field === "price_numeric") {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string") return v.trim() || null;
  return v ?? null;
}

async function resolveSupplierContactId(
  supabase: any,
  supplierContactId: string | null,
  email: string | null
): Promise<string | null> {
  if (supplierContactId) return supplierContactId;
  if (!email) return null;
  const { data } = await supabase
    .from("supplier_contacts")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  return data?.id || null;
}

// GET — list quotes for a supplier.
export async function GET(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    if (!session?.teamMember) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();
    const supplierContactId = req.nextUrl.searchParams.get("supplier_contact_id");
    const email = req.nextUrl.searchParams.get("email");

    const scId = await resolveSupplierContactId(supabase, supplierContactId, email);
    if (!scId) {
      return NextResponse.json({ quotes: [] });
    }

    const { data, error } = await supabase
      .from("supplier_quotes")
      .select("*")
      .eq("supplier_contact_id", scId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quotes: data || [], supplier_contact_id: scId });
  } catch (error: any) {
    console.error("GET /api/supplier-quotes failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to load quotes" }, { status: 500 });
  }
}

// POST — add a quote (manual add from the contact page).
export async function POST(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    if (!session?.teamMember) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();
    const body = await req.json();

    const scId = await resolveSupplierContactId(
      supabase,
      body.supplier_contact_id || null,
      body.email || null
    );
    if (!scId) {
      return NextResponse.json(
        { error: "supplier_contact_id or a known supplier email is required" },
        { status: 400 }
      );
    }

    const materialName = typeof body.material_name === "string" ? body.material_name.trim() : "";
    if (!materialName) {
      return NextResponse.json({ error: "material_name is required" }, { status: 400 });
    }

    const row: Record<string, any> = {
      supplier_contact_id: scId,
      source_conversation_id: body.source_conversation_id || null,
      created_by: session.teamMember.id || null,
    };
    for (const field of QUOTE_FIELDS) {
      if (field in body) row[field] = cleanField(field, body[field]);
    }
    row.material_name = materialName;

    const { data, error } = await supabase
      .from("supplier_quotes")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quote: data });
  } catch (error: any) {
    console.error("POST /api/supplier-quotes failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to add quote" }, { status: 500 });
  }
}

// PATCH — edit an existing quote by id.
export async function PATCH(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    if (!session?.teamMember) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();
    const body = await req.json();
    const id = body.id;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const update: Record<string, any> = {};
    for (const field of QUOTE_FIELDS) {
      if (field in body) update[field] = cleanField(field, body[field]);
    }
    if ("material_name" in update && !update.material_name) {
      return NextResponse.json({ error: "material_name cannot be empty" }, { status: 400 });
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("supplier_quotes")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quote: data });
  } catch (error: any) {
    console.error("PATCH /api/supplier-quotes failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to update quote" }, { status: 500 });
  }
}

// DELETE — remove a quote by id (?id=...).
export async function DELETE(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    if (!session?.teamMember) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { error } = await supabase.from("supplier_quotes").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/supplier-quotes failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete quote" }, { status: 500 });
  }
}
