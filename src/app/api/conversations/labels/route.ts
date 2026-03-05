import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createServerClient } from "@/lib/supabase";

// POST — Add label to conversation
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId, labelId } = await req.json();
  if (!conversationId || !labelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from("conversation_labels")
    .upsert({ conversation_id: conversationId, label_id: labelId });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true }, { status: 201 });
}

// DELETE — Remove label from conversation
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId, labelId } = await req.json();
  if (!conversationId || !labelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from("conversation_labels")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("label_id", labelId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
