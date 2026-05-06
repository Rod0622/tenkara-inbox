"use client";


export default function HighlightedText({ text, query, matchRefs, startIndex }: {
  text: string;
  query: string;
  matchRefs: React.MutableRefObject<(HTMLElement | null)[]>;
  startIndex: number;
}) {
  if (!query.trim() || !text) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  let matchIdx = startIndex;
  return (
    <>
      {parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
          const idx = matchIdx++;
          return (
            <mark
              key={i}
              ref={(el) => { matchRefs.current[idx] = el; }}
              data-match-idx={idx}
              className="bg-[var(--highlight)]/40 text-[var(--text-primary)] rounded px-0.5"
            >
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}