import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Columns the client is allowed to write to supplier_profiles.
const PROFILE_FIELDS = [
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

// Resolve supplier_contact_id from an explicit id or an email.
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
      return NextResponse.json({ profile: null });
    }

    const { data, error } = await supabase
      .from("supplier_profiles")
      .select("*")
      .eq("supplier_contact_id", scId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data || null, supplier_contact_id: scId });
  } catch (error: any) {
    console.error("GET /api/supplier-profile failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to load profile" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
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

    // Build the update from allowed fields only. Empty strings are stored as null.
    const update: Record<string, any> = {};
    for (const field of PROFILE_FIELDS) {
      if (field in body) {
        const v = body[field];
        update[field] = typeof v === "string" ? (v.trim() || null) : v ?? null;
      }
    }

    update.supplier_contact_id = scId;
    update.updated_by = session.teamMember.id || null;

    // Upsert on the unique supplier_contact_id so the first edit creates the row.
    const { data, error } = await supabase
      .from("supplier_profiles")
      .upsert(update, { onConflict: "supplier_contact_id" })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error: any) {
    console.error("PATCH /api/supplier-profile failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to save profile" }, { status: 500 });
  }
}
