import { quickFrontendReady, hideQuickWindow, writeClipboardSafe, cleanupClipboardText, translateStream, showMainWithText } from '../services/tauriBridge';
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Copy, Expand, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import VanishMark from "../components/brand/VanishMark";
import { useThemeSync } from "../hooks/useTheme";
import { logError } from "../lib/logger";
import { errorMessage, isCancelledError } from "../lib/errors";

interface StreamChunk {
  requestId: number;
  chunk: string;
}

interface StreamDone {
  requestId: number;
  fullText: string;
}

const QUICK_WIDTH = 392;
const QUICK_MIN_HEIGHT = 132;
const QUICK_MAX_HEIGHT = 330;
type TranslationActivityState = "working" | "done" | "error" | "idle";

export default function QuickTranslateWindow() {
  const shellRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(1_000_000);
  const sourceRef = useRef("");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [source, setSource] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  useThemeSync();

  const broadcastActivity = useCallback((state: TranslationActivityState) => {
    void emit("translation-state", { state }).catch(() => {});
  }, []);

  const translateText = useCallback(async (rawText: string) => {
    const requestId = ++requestIdRef.current;
    setOutput("");
    setError("");
    setCopied(false);
    setLoading(true);
    broadcastActivity("working");

    try {
      const cleaned = await cleanupClipboardText({ text: rawText });
      if (requestId !== requestIdRef.current) return;
      if (!cleaned.trim()) throw new Error("未读取到可翻译的文字");
      sourceRef.current = cleaned;
      setSource(cleaned);
      const result = await translateStream({
        text: cleaned,
        direction: "auto",
        requestId,
      });
      if (requestId === requestIdRef.current && result) {
        setOutput((current) => current || result);
      }
      if (requestId === requestIdRef.current) broadcastActivity("done");
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      if (isCancelledError(reason)) {
        broadcastActivity("idle");
      } else {
        setError(errorMessage(reason));
        broadcastActivity("error");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [broadcastActivity]);

  useEffect(() => {
    document.body.classList.add("quick-window-body");
    return () => document.body.classList.remove("quick-window-body");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      try {
        const registered = await Promise.all([
          listen<string>("quick-translate", (event) => {
            void translateText(event.payload);
          }),
          listen<string>("quick-translate-error", (event) => {
            requestIdRef.current += 1;
            sourceRef.current = "";
            setSource("");
            setOutput("");
            setLoading(false);
            setError(event.payload);
            broadcastActivity("error");
          }),
          listen<StreamChunk>("translate-stream-chunk", (event) => {
            if (event.payload.requestId !== requestIdRef.current) return;
            setOutput((current) => current + event.payload.chunk);
          }),
          listen<StreamDone>("translate-stream-done", (event) => {
            if (event.payload.requestId !== requestIdRef.current) return;
            setOutput(event.payload.fullText);
            setLoading(false);
          }),
        ]);
        if (cancelled) {
          registered.forEach((cleanup) => cleanup());
          return;
        }
        cleanups.push(...registered);
        await quickFrontendReady();
      } catch (error) {
        logError("quick", "setup error", error);
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      broadcastActivity("idle");
    };
  }, [broadcastActivity, translateText]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const resize = () => {
      const height = Math.ceil(shell.scrollHeight || QUICK_MIN_HEIGHT);
      const clamped = Math.max(QUICK_MIN_HEIGHT, Math.min(QUICK_MAX_HEIGHT, height));
      void getCurrentWindow().setSize(new LogicalSize(QUICK_WIDTH, clamped)).catch(() => {});
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [source, output, error, loading]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void hideQuickWindow();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    await writeClipboardSafe({ text: output });
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1100);
  }, [output]);

  const handleExpand = useCallback(() => {
    if (!sourceRef.current) return;
    void showMainWithText({ text: sourceRef.current });
  }, []);

  const handleDrag = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging().catch(() => {});
  }, []);

  const status = error ? "未完成" : loading ? "翻译中" : output ? "已完成" : "即时翻译";

  return (
    <section ref={shellRef} className="quick-translate-shell" aria-label="即时翻译">
      <header className="quick-translate-header" onMouseDown={handleDrag} data-tauri-drag-region>
        <div className="quick-translate-brand">
          <VanishMark compact animated={false} decorative />
          <span className={loading ? "quick-translate-status quick-translate-status--active" : "quick-translate-status"}>
            {status}
          </span>
        </div>
        <div className="quick-translate-actions">
          <button type="button" onClick={handleCopy} disabled={!output} aria-label={copied ? "译文已复制" : "复制译文"} title={copied ? "已复制" : "复制"}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button type="button" onClick={handleExpand} disabled={!source} aria-label="在主窗口中打开" title="展开">
            <Expand size={14} />
          </button>
          <button type="button" onClick={() => hideQuickWindow()} aria-label="关闭迷你翻译" title="关闭">
            <X size={15} />
          </button>
        </div>
      </header>

      {source && (
        <div className="quick-source selectable" title={source}>
          {source}
        </div>
      )}

      <div className="quick-result" role="status" aria-live="polite">
        {error ? (
          <div className="quick-error">
            <span>{error}</span>
            {source && (
              <button type="button" onClick={() => translateText(source)} aria-label="重试翻译" title="重试">
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        ) : output ? (
          <p className={loading ? "quick-result-text selectable quick-result-text--streaming" : "quick-result-text selectable"}>
            {output}
          </p>
        ) : (
          <div className="quick-loading" aria-label="正在翻译"><i /><i /><i /></div>
        )}
      </div>
    </section>
  );
}
