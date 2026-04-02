import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/search?q=keyword&user_id=xxx — Search across all messages and conversations
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const userId = req.nextUrl.searchParams.get("user_id");

  if (!q || q.length < 2) {
    return NextResponse.json({ conversation_ids: [] });
  }

  const searchTerm = "%" + q + "%";

  // Search in messages (body_text, snippet, subject, from_name, from_email)
  const { data: msgMatches } = await supabase
    .from("messages")
    .select("conversation_id")
    .or(`body_text.ilike.${searchTerm},snippet.ilike.${searchTerm},subject.ilike.${searchTerm},from_name.ilike.${searchTerm},from_email.ilike.${searchTerm},to_addresses.ilike.${searchTerm}`)
    .limit(500);

  // Search in conversations (subject, from_name, from_email, preview)
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

  return NextResponse.json({ conversation_ids: Array.from(ids) });
}
