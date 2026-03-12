import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function normalizeEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function parseAddressList(value?: string | null) {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((part) => normalizeEmail(part))
    .filter(Boolean);
}

function pickExternalEmail(params: {
  sharedEmail: string;
  conversationFrom?: string | null;
  messages?: Array<{ from_email?: string | null; to_addresses?: string | null }>;
}) {
  const shared = normalizeEmail(params.sharedEmail);
  const scores = new Map<string, number>();

  const addCandidate = (email?: string | null, weight = 1) => {
    const normalized = normalizeEmail(email);
    if (!normalized || normalized === shared) return;
    scores.set(normalized, (scores.get(normalized) || 0) + weight);
  };

  addCandidate(params.conversationFrom, 3);

  for (const msg of params.messages || []) {
    addCandidate(msg.from_email, 2);
    for (const to of parseAddressList(msg.to_addresses)) {
      addCandidate(to, 2);
    }
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] || null;
}

function conversationTouchesExternalEmail(
  conversation: any,
  messages: Array<{ from_email?: string | null; to_addresses?: string | null }>,
  sharedEmail: string,
  externalEmail: string
) {
  const shared = normalizeEmail(sharedEmail);
  const external = normalizeEmail(externalEmail);

  const candidates = new Set<string>();

  const convoFrom = normalizeEmail(conversation?.from_email);
  if (convoFrom && convoFrom !== shared) candidates.add(convoFrom);

  for (const msg of messages || []) {
    const from = normalizeEmail(msg.from_email);
    if (from && from !== shared) candidates.add(from);

    for (const to of parseAddressList(msg.to_addresses)) {
      if (to && to !== shared) candidates.add(to);
    }
  }

  return candidates.has(external);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const conversationId = req.nextUrl.searchParams.get("conversation_id");

    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
    }

    const { data: currentConversation, error: convoError } = await supabase
      .from("conversations")
      .select("id, email_account_id, subject, from_name, from_email, assignee_id, folder_id, status, last_message_at")
      .eq("id", conversationId)
      .single();

    if (convoError || !currentConversation) {
      return NextResponse.json(
        { error: convoError?.message || "Conversation not found" },
        { status: 404 }
      );
    }

    const { data: account, error: accountError } = await supabase
      .from("email_accounts")
      .select("id, email")
      .eq("id", currentConversation.email_account_id)
      .single();

    if (accountError || !account) {
      return NextResponse.json(
        { error: accountError?.message || "Shared account not found" },
        { status: 404 }
      );
    }

    const sharedEmail = normalizeEmail(account.email);

    const { data: currentMessages, error: currentMessagesError } = await supabase
      .from("messages")
      .select("from_email, to_addresses, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (currentMessagesError) {
      return NextResponse.json(
        { error: currentMessagesError.message },
        { status: 500 }
      );
    }

    const externalEmail = pickExternalEmail({
      sharedEmail,
      conversationFrom: currentConversation.from_email,
      messages: currentMessages || [],
    });

    if (!externalEmail) {
      return NextResponse.json({
        external_email: null,
        threads: [],
      });
    }

    const { data: candidateConversations, error: candidatesError } = await supabase
      .from("conversations")
      .select(`
        id,
        email_account_id,
        folder_id,
        thread_id,
        subject,
        from_name,
        from_email,
        preview,
        is_unread,
        is_starred,
        assignee_id,
        status,
        last_message_at,
        created_at,
        labels:conversation_labels(
          label_id,
          label:labels(*)
        ),
        assignee:team_members!conversations_assignee_id_fkey(*)
      `)
      .eq("email_account_id", currentConversation.email_account_id)
      .neq("id", conversationId)
      .order("last_message_at", { ascending: false })
      .limit(250);

    if (candidatesError) {
      return NextResponse.json({ error: candidatesError.message }, { status: 500 });
    }

    const candidateIds = (candidateConversations || []).map((c: any) => c.id);

    let messagesByConversation = new Map<
      string,
      Array<{ from_email?: string | null; to_addresses?: string | null }>
    >();

    if (candidateIds.length > 0) {
      const { data: candidateMessages, error: candidateMessagesError } = await supabase
        .from("messages")
        .select("conversation_id, from_email, to_addresses, sent_at")
        .in("conversation_id", candidateIds)
        .order("sent_at", { ascending: true });

      if (candidateMessagesError) {
        return NextResponse.json({ error: candidateMessagesError.message }, { status: 500 });
      }

      messagesByConversation = (candidateMessages || []).reduce((map, msg: any) => {
        const list = map.get(msg.conversation_id) || [];
        list.push({
          from_email: msg.from_email,
          to_addresses: msg.to_addresses,
        });
        map.set(msg.conversation_id, list);
        return map;
      }, new Map<string, Array<{ from_email?: string | null; to_addresses?: string | null }>>());
    }

    const folderIds = Array.from(
      new Set(
        (candidateConversations || [])
          .map((c: any) => c.folder_id)
          .filter(Boolean)
      )
    );

    const folderMap = new Map<string, any>();
    if (folderIds.length > 0) {
      const { data: folders } = await supabase
        .from("folders")
        .select("id, name, icon, color, is_system")
        .in("id", folderIds);

      for (const folder of folders || []) {
        folderMap.set(folder.id, folder);
      }
    }

    const relatedThreads = (candidateConversations || [])
      .filter((conversation: any) =>
        conversationTouchesExternalEmail(
          conversation,
          messagesByConversation.get(conversation.id) || [],
          sharedEmail,
          externalEmail
        )
      )
      .map((conversation: any) => ({
        ...conversation,
        folder: conversation.folder_id ? folderMap.get(conversation.folder_id) || null : null,
      }));

    return NextResponse.json({
      external_email: externalEmail,
      shared_email: sharedEmail,
      threads: relatedThreads,
    });
  } catch (error: any) {
    console.error("GET /api/conversations/by-contact failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch related threads" },
      { status: 500 }
    );
  }
}