import { hideQuickWindow, writeClipboardSafe, showMainWithText } from "../services/tauriBridge";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import QuickTranslationView from "./QuickTranslationView";
import { useThemeSync } from "../hooks/useTheme";
import { useQuickTranslation } from "../hooks/useQuickTranslation";
import { errorMessage } from "../lib/errors";

const QUICK_WIDTH = 392;
const QUICK_MIN_HEIGHT = 132;
const QUICK_MAX_HEIGHT = 330;

export default function QuickTranslateWindow() {
  const shellRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const { inputText: source, outputText: output, translationError: error, loading, translateText, editing, setInputText } = useQuickTranslation();
  useThemeSync();
  useEffect(() => {
    document.body.classList.add("quick-window-body");
    return () => document.body.classList.remove("quick-window-body");
  }, []);
  useEffect(() => {
    if (loading) {
      setCopied(false);
      setCopyError("");
    }
  }, [loading]);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  // The observer itself reports content growth, so this effect only runs once.
  // Each native setSize is gated on the clamped height actually changing, so
  // streamed chunks no longer churn dozens of identical window resizes.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    let lastHeight = -1;
    const resize = () => {
      const height = Math.ceil(shell.scrollHeight || QUICK_MIN_HEIGHT);
      const clamped = Math.max(QUICK_MIN_HEIGHT, Math.min(QUICK_MAX_HEIGHT, height));
      if (clamped === lastHeight) return;
      lastHeight = clamped;
      void getCurrentWindow().setSize(new LogicalSize(QUICK_WIDTH, clamped)).catch(() => {});
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void hideQuickWindow();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    try {
      await writeClipboardSafe({ text: output });
      setCopied(true);
      setCopyError("");
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1100);
    } catch (copyFailure) {
      setCopied(false);
      setCopyError(errorMessage(copyFailure) || "复制失败，请重试");
    }
  }, [output]);

  const handleExpand = useCallback(() => {
    if (!source) return;
    void showMainWithText({ text: source });
  }, [source]);

  const handleDrag = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging().catch(() => {});
  }, []);

  return (
    <QuickTranslationView
      shellRef={shellRef}
      source={source}
      output={output}
      error={error}
      loading={loading}
      copied={copied}
      copyError={copyError}
      editing={editing}
      onSourceChange={setInputText}
      onDrag={handleDrag}
      onCopy={() => void handleCopy()}
      onExpand={handleExpand}
      onClose={() => void hideQuickWindow()}
      onRetry={() => void translateText(source)}
    />
  );
}
