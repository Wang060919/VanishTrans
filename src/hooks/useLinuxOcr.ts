import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isLinuxCore } from "../lib/platform";
import { linuxScreenshotOcr, normalizeCommandError } from "../services/tauriBridge";

/** OCR is a draft for explicit review, never a translation request. */
export function useLinuxOcr() {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("eng");
  const active = useRef(false);
  const mounted = useRef(true);
  const start = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    setText(null);
    try {
      const result = await linuxScreenshotOcr(language);
      if (mounted.current) setText(result);
    } catch (failure) {
      const normalized = normalizeCommandError(failure);
      if (mounted.current) setError(normalized.code === "CANCELLED" ? "已取消截图。" : normalized.message);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [language]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!isLinuxCore()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen("linux-screenshot-request", () => { void start(); })
      .then((unlisten) => { if (disposed) unlisten(); else cleanup = unlisten; })
      .catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, [start]);
  return { busy, text, setText, error, language, setLanguage, start, dismiss: () => setText(null) };
}
