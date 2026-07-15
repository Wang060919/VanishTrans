import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

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
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

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
      cleanups.push(u1);

      const u2 = await listen<string>("ocr-translate", (event) => {
        onOcrTranslate(event.payload);
      });
      cleanups.push(u2);

      const u3 = await listen<string>("clipboard-watch-translate", (event) => {
        onClipboardTranslate(event.payload);
      });
      cleanups.push(u3);

      const u4 = await listen("screenshot-start", () => {
        onScreenshotStart();
      });
      cleanups.push(u4);

      const u5 = await listen<string>("translate-stream-chunk", (event) => {
        onStreamChunk(event.payload);
      });
      cleanups.push(u5);

      const u6 = await listen<string>("translate-stream-done", (event) => {
        onStreamDone(event.payload);
      });
      cleanups.push(u6);

      // Auto-hide: Rust emits event, JS handles the 150ms delay
      const u7 = await listen("schedule-auto-hide", () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(async () => {
          try {
            const win = getCurrentWindow();
            const focused = await win.isFocused();
            if (!focused) {
              await win.hide();
            }
          } catch (_) {}
        }, 150);
      });
      cleanups.push(u7);
    };

    setup();

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      cleanups.forEach((fn) => fn());
    };
    // Intentionally stable — callbacks are identity-stable from the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
