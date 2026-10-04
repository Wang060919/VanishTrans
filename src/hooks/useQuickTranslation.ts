import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { quickFrontendReady, reserveQuickRequest, revealQuickResult } from "../services/tauriBridge";
import { logError } from "../lib/logger";
import { useTextTranslation } from "./useTextTranslation";
import { useTranslationSession, type LangDirection } from "./useTranslationSession";

// Reset a stale QUICK_FRONTEND_READY left over from a previous webview load
// as early as possible; the effect re-asserts it once listeners are live.
void Promise.resolve().then(() => quickFrontendReady(false)).catch(() => {});

const LISTENER_SETUP_ATTEMPTS = 3;
const LISTENER_RETRY_DELAY_MS = 250;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `quick-translate` accepts an object payload; a bare string stays auto-translate for compatibility. */
function normalizeQuickPayload(payload: unknown): { text: string; edit: boolean } | null {
  if (typeof payload === "string") return payload.trim() ? { text: payload, edit: false } : null;
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.text !== "string" || !candidate.text.trim()) return null;
  return { text: candidate.text, edit: candidate.edit === true };
}

/** Quick-window event registration; request semantics are shared with the main window. */
export function useQuickTranslation() {
  const session = useTranslationSession(1_000_000, reserveQuickRequest, "quick");
  const direction = useRef<LangDirection>("auto");
  const { doTranslateStream: translateStream } = useTextTranslation(session, direction);
  const { reset, handleStreamChunk, handleStreamDone, applyExternalResult, setInputText } = session;
  const [editing, setEditing] = useState(false);
  const translateText = useCallback(async (text: string) => {
    setEditing(false);
    await translateStream(text);
  }, [translateStream]);
  useEffect(() => {
    let cancelled = false;
    let readyReported = false;
    const cleanups: (() => void)[] = [];
    const setup = async () => {
      await quickFrontendReady(false).catch(() => {});
      const results = await Promise.allSettled([
        Promise.resolve().then(() => listen<unknown>("quick-translate", ({ payload }) => {
          const request = normalizeQuickPayload(payload);
          if (!request) return;
          // Edit mode (OCR) only prefills the source; the user confirms the
          // text and presses translate before any request fires.
          if (request.edit) {
            reset();
            setInputText(request.text);
            setEditing(true);
            return;
          }
          void translateText(request.text);
        })),
        Promise.resolve().then(() => listen<string>("quick-translate-error", ({ payload }) => reset(payload))),
        Promise.resolve().then(() => listen<{ source: string; text: string; requestSeq: number }>(
          "quick-translate-result", ({ payload }) => {
            if (applyExternalResult(payload)) {
              void revealQuickResult({ requestSeq: payload.requestSeq }).catch((error: unknown) =>
                logError("quick", "failed to reveal accepted fallback", error));
            }
          })),
        Promise.resolve().then(() => listen<{ requestId: number; chunk: string }>(
          "translate-stream-chunk", ({ payload }) => handleStreamChunk(payload))),
        Promise.resolve().then(() => listen<{ requestId: number; fullText: string }>(
          "translate-stream-done", ({ payload }) => handleStreamDone(payload))),
      ]);
      const registered = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failed = results.find((result) => result.status === "rejected");
      if (cancelled || failed) {
        registered.forEach((cleanup) => cleanup());
        if (cancelled) return;
        if (failed?.status === "rejected") throw failed.reason;
        return;
      }
      cleanups.push(...registered);
      await quickFrontendReady(true);
      if (cancelled) {
        cleanups.splice(0).forEach((cleanup) => cleanup());
        await quickFrontendReady(false).catch(() => {});
        return;
      }
      readyReported = true;
    };
    // Retry a failed registration briefly: without listeners the quick window
    // can never report ready, so every quick request would time out at 5s.
    void (async () => {
      for (let attempt = 0; attempt < LISTENER_SETUP_ATTEMPTS && !cancelled; attempt += 1) {
        try {
          await setup();
          return;
        } catch (error) {
          cleanups.splice(0).forEach((cleanup) => cleanup());
          if (cancelled) return;
          if (attempt + 1 >= LISTENER_SETUP_ATTEMPTS) {
            logError("quick", "setup error", error);
            return;
          }
          await wait(LISTENER_RETRY_DELAY_MS);
        }
      }
    })();
    return () => {
      cancelled = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      if (readyReported) void quickFrontendReady(false).catch(() => {});
    };
  }, [applyExternalResult, handleStreamChunk, handleStreamDone, reset, setInputText, translateText]);
  return { ...session, translateText, editing };
}
