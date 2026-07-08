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

  // Search highlighting: walk text nodes and wrap matches in <mark>.
  //
  // The tricky part: this component renders via dangerouslySetInnerHTML, and
  // `resolvedHtml` changes when inline images resolve (~1s after mount). Each
  // time React re-applies innerHTML it OVERWRITES our injected marks with the
  // raw HTML — so a one-time highlight pass gets silently wiped, and the
  // highlights "disappear after a second". Relying on the effect re-running is
  // fragile because of commit/effect ordering.
  //
  // Robust fix: after highlighting, we also attach a MutationObserver to the
  // container. If anything replaces the content (image resolve, any re-render),
  // the observer re-runs the highlight pass. The observer is disconnected while
  // we mutate (to avoid reacting to our own marks) and reconnected after.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const q = (searchQuery || "").trim();

    let observer: MutationObserver | null = null;
    let rehighlightTimer: ReturnType<typeof setTimeout> | null = null;

    // Remove any marks from a previous pass, restoring plain text.
    const stripExistingMarks = () => {
      const prior = container.querySelectorAll("mark[data-match-idx]");
      prior.forEach((mk) => {
        const parent = mk.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mk.textContent || ""), mk);
        parent.normalize();
      });
    };

    const highlight = () => {
      stripExistingMarks();
      if (!q) return;

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
    };

    // Run highlight without the observer reacting to our own DOM writes.
    const runHighlight = () => {
      if (observer) observer.disconnect();
      highlight();
      // Reconnect on the next tick so our synchronous mutations settle first.
      if (observer) {
        requestAnimationFrame(() => {
          if (observer) observer.observe(container, { childList: true, subtree: true });
        });
      }
    };

    // Initial pass.
    runHighlight();

    // Only bother observing when there's an active query worth re-applying.
    if (q) {
      observer = new MutationObserver((mutations) => {
        // React overwriting innerHTML shows up as childList add/remove. When
        // that happens our marks are gone, so re-highlight (debounced).
        const contentReplaced = mutations.some(
          (m) => m.type === "childList" && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
        );
        if (!contentReplaced) return;
        // If marks are already present, nothing to do (avoids churn).
        if (container.querySelector("mark[data-match-idx]")) return;
        if (rehighlightTimer) clearTimeout(rehighlightTimer);
        rehighlightTimer = setTimeout(runHighlight, 30);
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      if (observer) observer.disconnect();
      if (rehighlightTimer) clearTimeout(rehighlightTimer);
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