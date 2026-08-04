import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "vanish-theme";

function readInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function resolveSystemTheme(): "light" | "dark" {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    const applyTheme = () => {
      const resolved = theme === "system" ? resolveSystemTheme() : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themeMode = theme;
      // Broadcast to other windows (e.g. ball window)
      void emit("theme-change", resolved).catch(() => {});
    };

    applyTheme();
    localStorage.setItem(STORAGE_KEY, theme);

    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [theme]);

  return { theme, setTheme };
}

/** Listen for theme changes broadcast from the main window. */
export function useThemeSync() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      if (cancelled) return;
      const unlisten = await listen<string>("theme-change", (event) => {
        if (!cancelled) {
          document.documentElement.dataset.theme = event.payload;
        }
      });
      if (cancelled) { unlisten(); return; }
      cleanup = unlisten;
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
}
