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

  try {
    if (countOnly) {
      const { count, error } = await supabase
        .from("email_drafts")
        .select("id", { count: "exact", head: true })
        .eq("requires_sender_selection", true)
        .not("created_by_agent", "is", null);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ count: count || 0 });
    }

    // Full list. The conversation join surfaces the supplier email + thread
    // context so the panel can show a meaningful row even though the draft
    // itself doesn't carry a separate "supplier" column.
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
          thread_id
        )
        `
      )
      .eq("requires_sender_selection", true)
      .not("created_by_agent", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ drafts: drafts || [] });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
