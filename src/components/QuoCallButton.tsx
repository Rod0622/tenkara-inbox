// src/components/QuoCallButton.tsx
//
// Tiny click-to-call button. Opens a `tel:` link, which on macOS/Windows
// hands the dial off to the user's default phone app (Quo desktop if
// installed). On mobile browsers, opens the native dialer.
//
// We deliberately don't try to POST to the Quo API to *place* the call —
// Quo's API doesn't fully support that flow and the user would still need
// to be in front of Quo to actually talk. The `tel:` link is the simplest,
// most reliable path.
//
// Usage:
//   <QuoCallButton phone="+1234567890" name="Yna Csorders" />
//
// Renders a small phone icon. Hover shows tooltip with phone number.

"use client";

import { Phone } from "lucide-react";

export default function QuoCallButton({
  phone,
  name,
  size = 12,
  className = "",
}: {
  phone: string | null | undefined;
  name?: string;
  size?: number;
  className?: string;
}) {
  if (!phone) return null;
  const cleaned = phone.trim();
  if (!cleaned) return null;

  const href = `tel:${cleaned.replace(/[^\d+]/g, "")}`;
  const title = name ? `Call ${name} (${cleaned})` : `Call ${cleaned}`;

  return (
    <a
      href={href}
      title={title}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--info)] hover:bg-[var(--border)] transition-colors p-1 ${className}`}
      aria-label={title}
    >
      <Phone size={size} />
    </a>
  );
}
