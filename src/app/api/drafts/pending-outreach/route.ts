/**
 * GET /api/drafts/pending-outreach
 *
 * Returns the list of agent-created drafts that still need an operator to
 * pick a sending email account before they can go out. These are the rows
 * surfaced by the "Pending Outreach" sidebar entry.
 *
 * A draft qualifies when:
 *   requires_sender_selection = TRUE
 *   AND created_by_agent IS NOT NULL
 *
 * Two modes:
 *   • Default (no query string)         → full list with conversation join
 *   • ?count_only=true                  → just `{ count }`, for the sidebar
 *                                         badge poller. Avoids transferring
 *                                         body_html / body_text for the
 *                                         every-15s heartbeat.
 *
 * Auth: relies on Supabase RLS / service-role client. The route is mounted
 * inside the authenticated Next.js app shell — anonymous callers won't
 * reach it.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);
  const countOnly = searchParams.get("count_only") === "true";
  // Optional scoping (Stage 1): a per-folder Pending Outreach sub-view passes
  // folder_id; a per-account view passes account_id. When neither is set the
  // endpoint returns the global list (legacy behavior, used by the old panel
  // until the UI migrates).
  const folderId = searchParams.get("folder_id");
  const accountId = searchParams.get("account_id");

  // Membership: any UNSENT draft created by an agent. (Previously this was
  // limited to requires_sender_selection=true, which only covered cold-
  // outreach drafts missing a sender — it missed agent REPLY drafts that
  // already have an account. Pending Outreach is the review queue for ALL
  // agent drafts awaiting an operator, so we key on created_by_agent only.)
  try {
    // Always fetch the candidate set with the conversation join (which
    // carries folder_id + email_account_id), then apply folder/account
    // scoping in JS. PostgREST embedded-filter semantics are awkward for
    // "the parent's column equals X", and the agent-draft set is small.
    const { data: drafts, error } = await supabase
      .from("email_drafts")
      .select(
        `
        id,
        conversation_id,
        subject,
        body_text,
        body_html,
        to_addresses,
        cc_addresses,
        bcc_addresses,
        created_by_agent,
        requires_sender_selection,
        external_id,
        source,
        created_at,
        updated_at,
        conversation:conversations(
          id,
          subject,
          from_email,
          primary_contact_email,
          primary_contact_name,
          thread_id,
          folder_id,
          email_account_id
        )
        `
      )
      .not("created_by_agent", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Apply scoping. A draft matches a folder/account scope via its
    // conversation's folder_id / email_account_id.
    let scoped = (drafts || []) as any[];
    if (folderId) {
      scoped = scoped.filter(
        (d) => (d.conversation as any)?.folder_id === folderId
      );
    } else if (accountId) {
      scoped = scoped.filter(
        (d) => (d.conversation as any)?.email_account_id === accountId
      );
    }

    if (countOnly) {
      return NextResponse.json({ count: scoped.length });
    }

    // EGRESS OPTIMIZATION: this endpoint is polled every ~15s per open tab.
    // Shipping the full body_html (agent drafts are large HTML) on every poll
    // was a major PostgREST egress driver. The list UI only needs a short body
    // PREVIEW; the full body is fetched on demand at send time via
    // GET /api/drafts?id=<draftId>. So we strip body_html/body_text from the
    // polled payload and emit a server-truncated `body_preview` (300 chars)
    // computed the same way the UI did (text first, else stripped HTML).
    const stripTags = (html: string) =>
      html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const slimmed = scoped.map((d: any) => {
      const previewSource =
        (d.body_text && d.body_text.trim())
          ? d.body_text
          : (d.body_html ? stripTags(d.body_html) : "");
      const { body_text, body_html, ...rest } = d;
      return { ...rest, body_preview: previewSource.slice(0, 300) };
    });

    return NextResponse.json({ drafts: slimmed });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}