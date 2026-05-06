import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0B0E11",
          50: "#12161B",
          100: "#181D24",
          200: "#1E242C",
          300: "#262D37",
          400: "#484F58",
          500: "#7D8590",
          600: "#E6EDF3",
        },
        mint: {
          DEFAULT: "#4ADE80",
          dim: "rgba(74,222,128,0.12)",
          glow: "rgba(74,222,128,0.25)",
        },
        sky: {
          DEFAULT: "#58A6FF",
          dim: "rgba(88,166,255,0.12)",
        },
        coral: {
          DEFAULT: "#F0883E",
          dim: "rgba(240,136,62,0.12)",
        },
        rose: {
          DEFAULT: "#F85149",
          dim: "rgba(248,81,73,0.12)",
        },
        iris: {
          DEFAULT: "#BC8CFF",
          dim: "rgba(188,140,255,0.12)",
        },
        sun: {
          DEFAULT: "#F5D547",
          dim: "rgba(245,213,71,0.12)",
        },
        teal: {
          DEFAULT: "#39D2C0",
          dim: "rgba(57,210,192,0.12)",
        },
      },
      // ─── Phase 4a typography ───────────────────────────────
      // Reads from CSS variables set by next/font in layout.tsx.
      // sans  = DM Sans (existing body UI)
      // mono  = Geist Mono (was JetBrains Mono — Phase 4a swap)
      // serif = Instrument Serif (Atelier headlines — applied in 4b+)
      fontFamily: {
        sans: ["var(--font-sans)", "DM Sans", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "Geist Mono", "Consolas", "monospace"],
        serif: ["var(--font-serif)", "Instrument Serif", "Georgia", "serif"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        spin: "spin 0.8s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;