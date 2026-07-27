import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

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
  // Keep refs to the latest callbacks so event listeners never go stale
  const callbacksRef = useRef({
    onClipboardTranslate,
    onOcrTranslate,
    onScreenshotStart,
    onScreenshotError,
    onStreamChunk,
    onStreamDone,
  });
  callbacksRef.current = {
    onClipboardTranslate,
    onOcrTranslate,
    onScreenshotStart,
    onScreenshotError,
    onStreamChunk,
    onStreamDone,
  };

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
          callbacksRef.current.onClipboardTranslate(text);
        } catch (e: any) {
          callbacksRef.current.onClipboardTranslate(`ERROR:${e}`);
        }
      });
      if (cancelled) { u1(); return; }
      addCleanup(u1);

      const u2 = await listen<string>("ocr-translate", (event) => {
        callbacksRef.current.onOcrTranslate(event.payload);
      });
      if (cancelled) { u2(); return; }
      addCleanup(u2);

      const u3 = await listen<string>("clipboard-watch-translate", (event) => {
        callbacksRef.current.onClipboardTranslate(event.payload);
      });
      if (cancelled) { u3(); return; }
      addCleanup(u3);

      const u4 = await listen("screenshot-start", () => {
        callbacksRef.current.onScreenshotStart();
      });
      if (cancelled) { u4(); return; }
      addCleanup(u4);

      const screenshotErrorCleanup = await listen<string>("screenshot-error", (event) => {
        callbacksRef.current.onScreenshotError(event.payload);
      });
      if (cancelled) { screenshotErrorCleanup(); return; }
      addCleanup(screenshotErrorCleanup);

      const u5 = await listen<{ requestId: number; chunk: string }>("translate-stream-chunk", (event) => {
        callbacksRef.current.onStreamChunk(event.payload);
      });
      if (cancelled) { u5(); return; }
      addCleanup(u5);

      const u6 = await listen<{ requestId: number; fullText: string }>("translate-stream-done", (event) => {
        callbacksRef.current.onStreamDone(event.payload);
      });
      if (cancelled) { u6(); return; }
      addCleanup(u6);

    };

    void setup();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);
}
