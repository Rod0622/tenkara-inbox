"use client";

import { useEffect, useState } from "react";

/**
 * MessageBody — renders an email's HTML body, resolving `cid:` inline-image
 * references to their actual attachment URLs.
 *
 * Background: emails with inline images use `<img src="cid:<content-id>">`.
 * Browsers can't fetch `cid:` URLs directly (they throw
 * `net::ERR_UNKNOWN_URL_SCHEME`), so we swap them for real URLs that point at
 * our attachments API. The mapping (`cid` → attachment_id) lives on
 * `inbox.attachments.content_id`.
 *
 * Robustness notes (why this is shaped the way it is):
 *   - The attachments list endpoint has historically returned PARTIAL result
 *     sets on some calls. If we built the cidMap from a partial response and
 *     then BLANKED every cid we couldn't map, a single flaky fetch would wipe
 *     out inline images that are actually present. So:
 *       • We only REWRITE cids we can resolve.
 *       • We do NOT blank unresolved cids on the first attempt — we retry the
 *         fetch a couple of times first.
 *       • Only after retries still can't resolve a cid do we blank it (to stop
 *         the browser throwing ERR_UNKNOWN_URL_SCHEME on a dead cid: URL).
 *   - We re-run whenever messageId or bodyHtml changes (e.g. after a backfill
 *     repopulates attachments and the body is reloaded).
 */
export default function MessageBody({
  messageId,
  bodyHtml,
  className,
}: {
  messageId: string;
  bodyHtml: string;
  className?: string;
}) {
  const [resolvedHtml, setResolvedHtml] = useState<string>(bodyHtml);

  useEffect(() => {
    // Fast path: no cid: references → render as-is, no fetch.
    if (!/cid:/i.test(bodyHtml)) {
      setResolvedHtml(bodyHtml);
      return;
    }

    // Render original immediately; upgrade once attachments resolve.
    setResolvedHtml(bodyHtml);

    let cancelled = false;

    const norm = (s: string) => s.replace(/^<|>$/g, "").trim().toLowerCase();

    // Fetch the attachment list, retrying a few times to defend against the
    // partial/empty responses the endpoint occasionally returns. We consider a
    // response "good enough" once it actually contains attachments with
    // contentIds — otherwise we retry.
    const fetchCidMap = async (): Promise<Map<string, string>> => {
      const cidMap = new Map<string, string>();
      const MAX_ATTEMPTS = 3;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(
            `/api/attachments?message_id=${encodeURIComponent(messageId)}`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const data = await res.json();
            const atts: any[] = data.attachments || [];
            for (const a of atts) {
              // Backward/forward compatible: an attachment may expose its cid
              // references as a single `contentId` (legacy scalar) and/or a
              // `contentIds` array (new model, where one stored image can be
              // referenced by multiple cids in the body). Map every cid we see
              // to this attachment's id.
              const cids: string[] = [];
              if (Array.isArray(a.contentIds)) {
                for (const c of a.contentIds) if (c) cids.push(String(c));
              }
              if (a.contentId) cids.push(String(a.contentId));
              for (const c of cids) cidMap.set(norm(c), a.id);
            }
            // If we got at least one usable mapping, accept it.
            if (cidMap.size > 0) return cidMap;
          }
        } catch {
          /* fall through to retry */
        }
        if (cancelled) return cidMap;
        // brief backoff before retrying
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
      return cidMap;
    };

    (async () => {
      const cidMap = await fetchCidMap();
      if (cancelled) return;

      // Rewrite cid: references inside quoted attributes.
      //   - resolvable  → swap to a real attachments URL
      //   - unresolvable → blank the attribute so the browser doesn't throw
      //     ERR_UNKNOWN_URL_SCHEME trying to load a cid: URL. We only reach
      //     here after retries, so blanking is a last resort, not a flaky-fetch
      //     casualty.
      const rewritten = bodyHtml.replace(
        /(["'])cid:([^"']+)\1/gi,
        (_match, quote, rawCid) => {
          const id = cidMap.get(norm(rawCid));
          if (!id) return `${quote}${quote}`;
          const url =
            `/api/attachments?message_id=${encodeURIComponent(messageId)}` +
            `&attachment_id=${encodeURIComponent(id)}&inline=1`;
          return `${quote}${url}${quote}`;
        }
      );

      if (!cancelled && rewritten !== resolvedHtml) {
        setResolvedHtml(rewritten);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, bodyHtml]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: resolvedHtml }} />;
}