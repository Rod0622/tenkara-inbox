import type { Metadata } from "next";
import { DM_Sans, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "Tenkara Inbox",
  description: "Shared inbox for Tenkara Labs",
  icons: { icon: "/favicon.ico" },
};

// ─── Phase 4a: typography infrastructure ──────────────────────
// Three font families loaded via next/font (build-time bundled, no
// flash of unstyled text, no third-party request from the browser).
//
// CSS variables (--font-sans / --font-mono / --font-serif) are wired
// through tailwind.config.ts so utility classes `font-sans`,
// `font-mono`, `font-serif` resolve to these.
//
// DM Sans: existing body UI font (kept).
// Geist Mono: replaces JetBrains Mono. Thinner, more modern, matches
//   Option B's editorial aesthetic.
// Instrument Serif: Atelier headlines. Will be applied to specific
//   page titles and conversation subjects in subsequent sub-phases (4b+).

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400"],
  style: ["normal", "italic"],
});

/**
 * Inline script — runs before React hydrates, sets [data-theme] on <html>
 * before paint to prevent a "flash of wrong theme" on page load.
 *
 * Logic mirrors useTheme.readInitialTheme():
 *  1. localStorage key "tenkara-theme" wins if set
 *  2. else OS preference (prefers-color-scheme: light)
 *  3. else dark
 */
const themeBootScript = `
(function() {
  try {
    var t = null;
    try { t = localStorage.getItem('tenkara-theme'); } catch (e) {}
    if (t !== 'dark' && t !== 'light') {
      try {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) t = 'light';
        else t = 'dark';
      } catch (e) { t = 'dark'; }
    }
    document.documentElement.setAttribute('data-theme', t);
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Compose the three font CSS-variable classes onto <body>
  const fontClasses = `${dmSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`;

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className={fontClasses}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}