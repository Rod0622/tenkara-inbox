"use client";

import { useEffect, useState } from "react";

/**
 * MessageBody — renders an email's HTML body, resolving `cid:` inline-image
 * references to their actual attachment URLs.
 *
 * Background: emails with inline images use `<img src="cid:<content-id>">`.
 * Browsers can't fetch `cid:` URLs directly (they throw
 * `net::ERR_UNKNOWN_URL_SCHEME`), so we need to swap them for real URLs that
 * point at our attachments API. The mapping (`cid` → attachment_id) lives on
 * `inbox.attachments.content_id`.
 *
 * Behavior:
 *   - If the HTML has no `cid:` references, render it immediately. No fetch.
 *   - Otherwise, fetch the message's attachments, build a `cid → id` map,
 *     and rewrite every `cid:<id>` in the HTML to point at
 *     `/api/attachments?message_id=…&attachment_id=…&inline=1`.
 *   - While the fetch is in flight we render the original HTML — the broken
 *     image icons flash briefly, but only on first paint.
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
    // Fast path: no cid: references in the body → nothing to resolve.
    if (!/cid:/i.test(bodyHtml)) {
      setResolvedHtml(bodyHtml);
      return;
    }

    // Show the original HTML immediately, then upgrade once we resolve.
    setResolvedHtml(bodyHtml);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/attachments?message_id=${encodeURIComponent(messageId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const atts: any[] = data.attachments || [];
        if (atts.length === 0) return;

        // Build a normalized map: contentId → attachment_id.
        // Some senders include the brackets in the cid (e.g. "<abc@host>"),
        // others don't — we strip them on both sides to match reliably.
        const norm = (s: string) => s.replace(/^<|>$/g, "").trim().toLowerCase();
        const cidMap = new Map<string, string>();
        for (const a of atts) {
          if (a.contentId) cidMap.set(norm(a.contentId), a.id);
        }
        if (cidMap.size === 0) return;

        // Rewrite every `cid:…` URL inside a quoted attribute.
        // Catches src="cid:foo", src='cid:foo', and similar attrs (xlink:href, etc.)
        const rewritten = bodyHtml.replace(/(["'])cid:([^"']+)\1/gi, (match, quote, rawCid) => {
          const id = cidMap.get(norm(rawCid));
          if (!id) return match;
          const url = `/api/attachments?message_id=${encodeURIComponent(messageId)}&attachment_id=${encodeURIComponent(id)}&inline=1`;
          return `${quote}${url}${quote}`;
        });

        if (!cancelled && rewritten !== bodyHtml) {
          setResolvedHtml(rewritten);
        }
      } catch {
        /* silent — the original HTML stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId, bodyHtml]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: resolvedHtml }} />;
}
