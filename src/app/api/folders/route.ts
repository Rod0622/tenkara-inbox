import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { ensureFolderLabel } from "@/lib/folder-labels";

// GET /api/folders — list all folders
export async function GET() {
  const supabase = createServerClient();

  const { data: folders, error } = await supabase
    .from("folders")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ folders: folders || [] });
}

// POST /api/folders — create a new folder
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { email_account_id, name, icon, color, parent_folder_id } = body;

  if (!email_account_id || !name?.trim()) {
    return NextResponse.json(
      { error: "email_account_id and name are required" },
      { status: 400 }
    );
  }

  // Get the next sort_order for this account
  const { data: existing } = await supabase
    .from("folders")
    .select("sort_order")
    .eq("email_account_id", email_account_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (existing?.sort_order ?? -1) + 1;

  const { data: folder, error } = await supabase
    .from("folders")
    .insert({
      email_account_id,
      name: name.trim(),
      icon: icon || "📁",
      color: color || "#7D8590",
      sort_order: nextOrder,
      is_system: false,
      parent_folder_id: parent_folder_id || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Auto-create a label with the same name as the folder. Best-effort —
  // don't fail the request if the label hook errors. The label will be
  // applied to conversations when they are moved into this folder.
  try {
    if (folder?.id) await ensureFolderLabel(folder.id);
  } catch (e: any) {
    console.error("[folders/POST] ensureFolderLabel failed:", e?.message || e);
  }

  return NextResponse.json({ folder });
}

// DELETE /api/folders?id=xxx — delete a folder
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const folderId = req.nextUrl.searchParams.get("id");

  if (!folderId) {
    return NextResponse.json({ error: "Folder id is required" }, { status: 400 });
  }

  // Don't allow deleting system folders
  const { data: folder } = await supabase
    .from("folders")
    .select("is_system")
    .eq("id", folderId)
    .single();

  if (folder?.is_system) {
    return NextResponse.json(
      { error: "Cannot delete system folders" },
      { status: 403 }
    );
  }

  // Unassign conversations from this folder
  await supabase
    .from("conversations")
    .update({ folder_id: null })
    .eq("folder_id", folderId);

  const { error } = await supabase
    .from("folders")
    .delete()
    .eq("id", folderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}