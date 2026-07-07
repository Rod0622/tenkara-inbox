"use client";

import { useEffect, useRef, useState } from "react";

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
 *
 * Search highlighting (searchQuery):
 *   - When a thread search is active, we highlight matches by walking the
 *     rendered DOM's TEXT NODES ONLY and wrapping matches in <mark>. Because we
 *     never touch element tags, tables/formatting stay fully intact (the old
 *     approach rendered plain text during search, which dissolved tables).
 *   - Each <mark> gets a data-match-idx so the existing match-navigation
 *     (which queries mark[data-match-idx] from the DOM) works unchanged.
 */
export default function MessageBody({
  messageId,
  bodyHtml,
  className,
  searchQuery,
  matchStartIndex = 0,
}: {
  messageId: string;
  bodyHtml: string;
  className?: string;
  searchQuery?: string;
  matchStartIndex?: number;
}) {
  const [resolvedHtml, setResolvedHtml] = useState<string>(bodyHtml);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        // Build a normalized map: contentId → attachment_id.
        const norm = (s: string) => s.replace(/^<|>$/g, "").trim().toLowerCase();
        const cidMap = new Map<string, string>();
        for (const a of atts) {
          if (a.contentId) cidMap.set(norm(a.contentId), a.id);
        }

        const rewritten = bodyHtml.replace(/(["'])cid:([^"']+)\1/gi, (_match, quote, rawCid) => {
          const id = cidMap.get(norm(rawCid));
          if (!id) return `${quote}${quote}`;
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

  // Search highlighting: walk text nodes and wrap matches in <mark>. Runs after
  // the HTML is in the DOM (and re-runs when the query or resolved HTML changes).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const q = (searchQuery || "").trim();
    if (!q) return; // nothing to highlight; DOM already reflects resolvedHtml

    // Collect text nodes, skipping ones inside <script>/<style> and existing marks.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const lowerQ = q.toLowerCase();
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) textNodes.push(n as Text);

    let matchIdx = matchStartIndex;
    for (const textNode of textNodes) {
      const text = textNode.nodeValue || "";
      const lower = text.toLowerCase();
      if (!lower.includes(lowerQ)) continue;

      // Build a replacement fragment: text split around each match, matches wrapped in <mark>.
      const frag = document.createDocumentFragment();
      let pos = 0;
      let found = lower.indexOf(lowerQ, pos);
      while (found !== -1) {
        if (found > pos) {
          frag.appendChild(document.createTextNode(text.slice(pos, found)));
        }
        const mark = document.createElement("mark");
        mark.setAttribute("data-match-idx", String(matchIdx++));
        mark.style.background = "color-mix(in srgb, var(--highlight) 40%, transparent)";
        mark.style.borderRadius = "2px";
        mark.textContent = text.slice(found, found + q.length);
        frag.appendChild(mark);
        pos = found + q.length;
        found = lower.indexOf(lowerQ, pos);
      }
      if (pos < text.length) {
        frag.appendChild(document.createTextNode(text.slice(pos)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    // Cleanup: on query/html change, React re-renders from resolvedHtml via
    // dangerouslySetInnerHTML, which replaces our injected marks wholesale. But
    // to be safe when only the query changes, force a re-set of the innerHTML.
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = resolvedHtml;
      }
    };
  }, [searchQuery, resolvedHtml, matchStartIndex]);

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: resolvedHtml }}
    />
  );
}