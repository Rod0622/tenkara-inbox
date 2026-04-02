import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ conversations: [] });
  }

  const searchTerm = "%" + q + "%";

  // Search in messages
  const { data: msgMatches } = await supabase
    .from("messages")
    .select("conversation_id")
    .or(`body_text.ilike.${searchTerm},snippet.ilike.${searchTerm},subject.ilike.${searchTerm},from_name.ilike.${searchTerm},from_email.ilike.${searchTerm},to_addresses.ilike.${searchTerm}`)
    .limit(500);

  // Search in conversations
  const { data: convoMatches } = await supabase
    .from("conversations")
    .select("id")
    .or(`subject.ilike.${searchTerm},from_name.ilike.${searchTerm},from_email.ilike.${searchTerm},preview.ilike.${searchTerm}`)
    .neq("status", "trash")
    .limit(500);

  // Search in notes
  const { data: noteMatches } = await supabase
    .from("notes")
    .select("conversation_id")
    .ilike("text", searchTerm)
    .limit(200);

  // Combine all matching conversation IDs
  const ids = new Set<string>();
  for (const m of (msgMatches || [])) { if (m.conversation_id) ids.add(m.conversation_id); }
  for (const c of (convoMatches || [])) { ids.add(c.id); }
  for (const n of (noteMatches || [])) { if (n.conversation_id) ids.add(n.conversation_id); }

  if (ids.size === 0) {
    return NextResponse.json({ conversations: [] });
  }

  // Fetch full conversation objects for all matches
  const idArray = Array.from(ids);
  const allConvos: any[] = [];
  
  // Batch in groups of 50 to avoid query limits
  for (let i = 0; i < idArray.length; i += 50) {
    const batch = idArray.slice(i, i + 50);
    const { data } = await supabase
      .from("conversations")
      .select(`id, email_account_id, folder_id, thread_id, subject, from_name, from_email, preview, is_unread, is_starred, assignee_id, status, has_attachments, last_message_at, created_at, updated_at, assignee:team_members!conversations_assignee_id_fkey(*), labels:conversation_labels(label_id, label:labels(*))`)
      .in("id", batch)
      .neq("status", "trash")
      .order("last_message_at", { ascending: false });
    if (data) allConvos.push(...data);
  }

  return NextResponse.json({ conversations: allConvos });
}