import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * /api/contact-command-center/persons
 * CRUD for inbox.supplier_contact_persons (humans at a supplier company).
 *
 *  POST   { supplier_contact_id, name, title?, email?, phone?, notes?, sort_order? }
 *  PATCH  { id, name?, title?, email?, phone?, notes?, sort_order? }
 *  DELETE ?id=<uuid>
 */

const ALLOWED_FIELDS = ["name", "title", "email", "phone", "notes", "sort_order"] as const;

// POST — create a new contact person
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();
    const { supplier_contact_id } = body;

    if (!supplier_contact_id) {
      return NextResponse.json({ error: "supplier_contact_id is required" }, { status: 400 });
    }
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const insertRow: any = {
      supplier_contact_id,
      name: body.name.trim(),
    };
    for (const f of ALLOWED_FIELDS) {
      if (f === "name") continue;
      if (body[f] !== undefined) {
        const v = body[f];
        insertRow[f] = typeof v === "string" ? (v.trim() || null) : v;
      }
    }

    const { data, error } = await supabase
      .from("supplier_contact_persons")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ person: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to create" }, { status: 500 });
  }
}

// PATCH — update an existing contact person
export async function PATCH(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const update: any = { updated_at: new Date().toISOString() };
    for (const f of ALLOWED_FIELDS) {
      if (body[f] !== undefined) {
        const v = body[f];
        if (f === "name") {
          // name has a NOT NULL constraint — refuse to blank it
          if (!v || typeof v !== "string" || !v.trim()) {
            return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
          }
          update.name = v.trim();
        } else {
          update[f] = typeof v === "string" ? (v.trim() || null) : v;
        }
      }
    }

    if (Object.keys(update).length === 1) {
      // only updated_at — nothing else to change
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("supplier_contact_persons")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ person: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update" }, { status: 500 });
  }
}

// DELETE — remove a contact person
export async function DELETE(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { error } = await supabase
      .from("supplier_contact_persons")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete" }, { status: 500 });
  }
}
