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
      document.documentElement.dataset.theme = theme === "system" ? resolveSystemTheme() : theme;
      document.documentElement.dataset.themeMode = theme;
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
