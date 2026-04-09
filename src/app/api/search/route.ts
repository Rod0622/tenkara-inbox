export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const accountId = req.nextUrl.searchParams.get("account_id") || null;
  const folderId = req.nextUrl.searchParams.get("folder_id") || null;
  const userEmail = req.nextUrl.searchParams.get("user_email") || null;

  if (!q || q.length < 2) {
    return NextResponse.json({ conversations: [], match_snippets: {} });
  }

  // Determine accessible account IDs for this user
  let accessibleAccountIds: string[] | null = null; // null = no restriction (admin or no access table)
  if (userEmail) {
    const { data: member } = await supabase.from("team_members").select("id, role").eq("email", userEmail).single();
    if (member && member.role !== "admin") {
      const { data: allAccounts } = await supabase.from("email_accounts").select("id").eq("is_active", true);
      const { data: accessData } = await supabase.from("account_access").select("email_account_id, team_member_id");
      const accessByAccount: Record<string, string[]> = {};
      for (const row of (accessData || [])) {
        if (!accessByAccount[row.email_account_id]) accessByAccount[row.email_account_id] = [];
        accessByAccount[row.email_account_id].push(row.team_member_id);
      }
      accessibleAccountIds = (allAccounts || [])
        .filter((a: any) => {
          const restrictedTo = accessByAccount[a.id];
          if (!restrictedTo || restrictedTo.length === 0) return true;
          return restrictedTo.includes(member.id);
        })
        .map((a: any) => a.id);
    }
  }

  const searchTerm = "%" + q + "%";

  // Search in messages (body_text, snippet, subject)
  const { data: msgMatches } = await supabase
    .from("messages")
    .select("conversation_id, body_text, snippet, subject")
    .or(`body_text.ilike.${searchTerm},snippet.ilike.${searchTerm},subject.ilike.${searchTerm},from_name.ilike.${searchTerm},from_email.ilike.${searchTerm},to_addresses.ilike.${searchTerm}`)
    .limit(500);

  // Search in conversations
  let convoQuery = supabase
    .from("conversations")
    .select("id, subject, preview, email_account_id, folder_id")
    .or(`subject.ilike.${searchTerm},from_name.ilike.${searchTerm},from_email.ilike.${searchTerm},preview.ilike.${searchTerm}`)
    .neq("status", "trash");
  if (accountId) convoQuery = convoQuery.eq("email_account_id", accountId);
  if (folderId) convoQuery = convoQuery.eq("folder_id", folderId);
  const { data: convoMatches } = await convoQuery.limit(500);

  // Search in notes
  const { data: noteMatches } = await supabase
    .from("notes")
    .select("conversation_id, text")
    .ilike("text", searchTerm)
    .limit(200);

  // Build match snippets - extract text around the matched word
  const matchSnippets: Record<string, string> = {};
  const qLower = q.toLowerCase();

  function extractSnippet(text: string, convoId: string) {
    if (!text || matchSnippets[convoId]) return;
    const idx = text.toLowerCase().indexOf(qLower);
    if (idx === -1) return;
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + (q?.length || 0) + 60);
    let snippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
    matchSnippets[convoId] = snippet;
  }

  // Collect conversation IDs and snippets
  const ids = new Set<string>();
  for (const m of (msgMatches || [])) {
    if (m.conversation_id) {
      ids.add(m.conversation_id);
      extractSnippet(m.body_text || m.snippet || m.subject || "", m.conversation_id);
    }
  }
  for (const c of (convoMatches || [])) {
    ids.add(c.id);
    extractSnippet(c.subject || c.preview || "", c.id);
  }
  for (const n of (noteMatches || [])) {
    if (n.conversation_id) {
      ids.add(n.conversation_id);
      extractSnippet(n.text || "", n.conversation_id);
    }
  }

  if (ids.size === 0) {
    return NextResponse.json({ conversations: [], match_snippets: {} });
  }

  // Fetch full conversation objects
  const idArray = Array.from(ids);
  const allConvos: any[] = [];
  for (let i = 0; i < idArray.length; i += 50) {
    const batch = idArray.slice(i, i + 50);
    let fetchQuery = supabase
      .from("conversations")
      .select(`id, email_account_id, folder_id, thread_id, subject, from_name, from_email, preview, is_unread, is_starred, assignee_id, status, has_attachments, last_message_at, created_at, updated_at, assignee:team_members!conversations_assignee_id_fkey(*), labels:conversation_labels(label_id, label:labels(*))`)
      .in("id", batch)
      .neq("status", "trash");
    if (accountId) fetchQuery = fetchQuery.eq("email_account_id", accountId);
    if (folderId) fetchQuery = fetchQuery.eq("folder_id", folderId);
    if (accessibleAccountIds) fetchQuery = fetchQuery.in("email_account_id", accessibleAccountIds);
    const { data } = await fetchQuery.order("last_message_at", { ascending: false });
    if (data) allConvos.push(...data);
  }

  return NextResponse.json({ conversations: allConvos, match_snippets: matchSnippets });
}