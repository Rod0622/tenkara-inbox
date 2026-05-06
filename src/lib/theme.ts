"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * useTheme — Phase 1 theme infrastructure (Batch 14)
 *
 * Reads/writes `data-theme="dark"` or `data-theme="light"` on <html>,
 * persists to localStorage as "tenkara-theme", and follows the OS preference
 * on first load (defaulting to dark if the OS has no preference).
 *
 * Phase 1 only ships the dark theme visually identical to today; the light
 * theme palette is defined but only takes effect when the user toggles.
 *
 * Usage:
 *   const { theme, setTheme, toggle } = useTheme();
 *   <button onClick={toggle}>...</button>
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "tenkara-theme";

function readInitialTheme(): Theme {
  // SSR safety
  if (typeof window === "undefined") return "dark";

  // 1. Persisted preference wins
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) — fall through
  }

  // 2. OS preference next
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {
    // matchMedia unavailable — fall through
  }

  // 3. Default dark (preserves current app behavior)
  return "dark";
}

function applyThemeToDocument(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  // Also keep a class for any places that prefer Tailwind's `dark:` modifier
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
} {
  // Initialize state lazily to avoid SSR hydration mismatch
  const [theme, setThemeState] = useState<Theme>(() => readInitialTheme());

  // On mount, ensure the document attribute reflects state and listen for OS changes
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Listen for OS theme changes — only honored if user has not set a manual preference
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        // If the user explicitly set a preference, don't override it
        if (stored === "dark" || stored === "light") return;
      } catch {
        // ignore
      }
      setThemeState(e.matches ? "light" : "dark");
    };
    // Modern browsers
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    // Older Safari fallback
    if (mq.addListener) {
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    }
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
