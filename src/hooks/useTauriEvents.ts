import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

interface TauriEventsOptions {
  onClipboardTranslate: (text: string) => void;
  onOcrTranslate: (text: string) => void;
  onScreenshotStart: () => void;
  onScreenshotError: (message: string) => void;
  onStreamChunk: (payload: { requestId: number; chunk: string }) => void;
  onStreamDone: (payload: { requestId: number; fullText: string }) => void;
}

export function useTauriEvents({
  onClipboardTranslate,
  onOcrTranslate,
  onScreenshotStart,
  onScreenshotError,
  onStreamChunk,
  onStreamDone,
}: TauriEventsOptions) {
  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    const addCleanup = (cleanup: () => void) => {
      if (cancelled) cleanup();
      else cleanups.push(cleanup);
    };

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
      if (cancelled) { u1(); return; }
      addCleanup(u1);

      const u2 = await listen<string>("ocr-translate", (event) => {
        onOcrTranslate(event.payload);
      });
      if (cancelled) { u2(); return; }
      addCleanup(u2);

      const u3 = await listen<string>("clipboard-watch-translate", (event) => {
        onClipboardTranslate(event.payload);
      });
      if (cancelled) { u3(); return; }
      addCleanup(u3);

      const u4 = await listen("screenshot-start", () => {
        onScreenshotStart();
      });
      if (cancelled) { u4(); return; }
      addCleanup(u4);

      const screenshotErrorCleanup = await listen<string>("screenshot-error", (event) => {
        onScreenshotError(event.payload);
      });
      if (cancelled) { screenshotErrorCleanup(); return; }
      addCleanup(screenshotErrorCleanup);

      const u5 = await listen<{ requestId: number; chunk: string }>("translate-stream-chunk", (event) => {
        onStreamChunk(event.payload);
      });
      if (cancelled) { u5(); return; }
      addCleanup(u5);

      const u6 = await listen<{ requestId: number; fullText: string }>("translate-stream-done", (event) => {
        onStreamDone(event.payload);
      });
      if (cancelled) { u6(); return; }
      addCleanup(u6);

    };

    void setup();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
    // Intentionally stable — callbacks are identity-stable from the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
