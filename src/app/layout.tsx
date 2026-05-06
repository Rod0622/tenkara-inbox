import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "Tenkara Inbox",
  description: "Shared inbox for Tenkara Labs",
  icons: { icon: "/favicon.ico" },
};

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
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}