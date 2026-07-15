import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

interface TauriEventsOptions {
  onClipboardTranslate: (text: string) => void;
  onOcrTranslate: (text: string) => void;
  onScreenshotStart: () => void;
  onStreamChunk: (chunk: string) => void;
  onStreamDone: (fullText: string) => void;
}

export function useTauriEvents({
  onClipboardTranslate,
  onOcrTranslate,
  onScreenshotStart,
  onStreamChunk,
  onStreamDone,
}: TauriEventsOptions) {
  const aliveRef = useRef(true);
  const cleanupsRef = useRef<(() => void)[]>([]);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    cleanupsRef.current = [];

    const setup = async () => {
      const u1 = await listen("shortcut-translate", async () => {
        try {
          const text = await invoke<string>("read_clipboard_safe").catch((e) => {
            if (e === "SKIP_OWN_CONTENT") return null;
            throw e;
          });
          if (!text || text.trim().length === 0) return;
          onClipboardTranslate(text);
        } catch (e: any) {
          onClipboardTranslate(`ERROR:${e}`);
        }
      });
      if (!aliveRef.current) { u1(); return; }
      cleanupsRef.current.push(u1);

      const u2 = await listen<string>("ocr-translate", (event) => {
        onOcrTranslate(event.payload);
      });
      if (!aliveRef.current) { u2(); return; }
      cleanupsRef.current.push(u2);

      const u3 = await listen<string>("clipboard-watch-translate", (event) => {
        onClipboardTranslate(event.payload);
      });
      if (!aliveRef.current) { u3(); return; }
      cleanupsRef.current.push(u3);

      const u4 = await listen("screenshot-start", () => {
        onScreenshotStart();
      });
      if (!aliveRef.current) { u4(); return; }
      cleanupsRef.current.push(u4);

      const u5 = await listen<string>("translate-stream-chunk", (event) => {
        onStreamChunk(event.payload);
      });
      if (!aliveRef.current) { u5(); return; }
      cleanupsRef.current.push(u5);

      const u6 = await listen<string>("translate-stream-done", (event) => {
        onStreamDone(event.payload);
      });
      if (!aliveRef.current) { u6(); return; }
      cleanupsRef.current.push(u6);

      // Auto-hide: Rust emits event, JS handles the 150ms delay
      const u7 = await listen("schedule-auto-hide", () => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(async () => {
          try {
            const win = getCurrentWindow();
            const focused = await win.isFocused();
            if (!focused) {
              await win.hide();
            }
          } catch (_) {}
        }, 150);
      });
      if (!aliveRef.current) { u7(); return; }
      cleanupsRef.current.push(u7);
    };

    setup();

    return () => {
      aliveRef.current = false;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      cleanupsRef.current.forEach((fn) => fn());
      cleanupsRef.current = [];
    };
    // Intentionally stable — callbacks are identity-stable from the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
