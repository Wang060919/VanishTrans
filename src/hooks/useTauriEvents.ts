import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

export type TranslationRequestEvent =
  | { type: "text"; text: string }
  | { type: "error"; message: string };

export interface ShortcutRegistrationConflict {
  action: string;
  shortcut: string;
  error: string;
}

interface TauriEventsOptions {
  onClipboardTranslate: (request: TranslationRequestEvent) => void;
  onOcrTranslate: (text: string) => void;
  onScreenshotStart: () => void;
  onScreenshotError: (message: string) => void;
  onShortcutConflicts: (conflicts: ShortcutRegistrationConflict[]) => void;
  onStreamChunk: (payload: { requestId: number; chunk: string }) => void;
  onStreamDone: (payload: { requestId: number; fullText: string }) => void;
}

export function normalizeTranslationRequest(payload: unknown): TranslationRequestEvent | null {
  if (typeof payload === "string") {
    return payload.trim() ? { type: "text", text: payload } : null;
  }
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload as Record<string, unknown>;
  if (candidate.type === "text" && typeof candidate.text === "string" && candidate.text.trim()) {
    return { type: "text", text: candidate.text };
  }
  if (candidate.type === "error" && typeof candidate.message === "string" && candidate.message.trim()) {
    return { type: "error", message: candidate.message };
  }
  return null;
}

export function useTauriEvents({
  onClipboardTranslate,
  onOcrTranslate,
  onScreenshotStart,
  onScreenshotError,
  onShortcutConflicts,
  onStreamChunk,
  onStreamDone,
}: TauriEventsOptions) {
  // Keep refs to the latest callbacks so event listeners never go stale
  const callbacksRef = useRef({
    onClipboardTranslate,
    onOcrTranslate,
    onScreenshotStart,
    onScreenshotError,
    onShortcutConflicts,
    onStreamChunk,
    onStreamDone,
  });
  callbacksRef.current = {
    onClipboardTranslate,
    onOcrTranslate,
    onScreenshotStart,
    onScreenshotError,
    onShortcutConflicts,
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
      const u1 = await listen<unknown>("shortcut-translate", (event) => {
        const request = normalizeTranslationRequest(event.payload);
        if (request) callbacksRef.current.onClipboardTranslate(request);
      });
      if (cancelled) { u1(); return; }
      addCleanup(u1);

      const u2 = await listen<string>("ocr-translate", (event) => {
        callbacksRef.current.onOcrTranslate(event.payload);
      });
      if (cancelled) { u2(); return; }
      addCleanup(u2);

      const u3 = await listen<unknown>("clipboard-watch-translate", (event) => {
        const request = normalizeTranslationRequest(event.payload);
        if (request) callbacksRef.current.onClipboardTranslate(request);
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

      const conflictCleanup = await listen<ShortcutRegistrationConflict[]>("shortcut-registration-conflicts", (event) => {
        callbacksRef.current.onShortcutConflicts(event.payload ?? []);
      });
      if (cancelled) { conflictCleanup(); return; }
      addCleanup(conflictCleanup);

    };

    void setup();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);
}
