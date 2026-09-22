import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { quickFrontendReady } from "../services/tauriBridge";
import { logError } from "../lib/logger";
import { useTextTranslation } from "./useTextTranslation";
import { useTranslationSession, type LangDirection } from "./useTranslationSession";

/** Quick-window event registration; request semantics are shared with the main window. */
export function useQuickTranslation() {
  const session = useTranslationSession(1_000_000);
  const direction = useRef<LangDirection>("auto");
  const { doTranslateStream: translateText } = useTextTranslation(session, direction);
  const { reset, handleStreamChunk, handleStreamDone } = session;
  useEffect(() => {
    let cancelled = false;
    let readyReported = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      try {
        await quickFrontendReady(false).catch(() => {});
        const results = await Promise.allSettled([
          Promise.resolve().then(() => listen<string>("quick-translate", ({ payload }) => {
            void translateText(payload);
          })),
          Promise.resolve().then(() => listen<string>("quick-translate-error", ({ payload }) => reset(payload))),
          Promise.resolve().then(() => listen<{ requestId: number; chunk: string }>(
            "translate-stream-chunk", ({ payload }) => handleStreamChunk(payload))),
          Promise.resolve().then(() => listen<{ requestId: number; fullText: string }>(
            "translate-stream-done", ({ payload }) => handleStreamDone(payload))),
        ]);
        const registered = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        const failed = results.find((result) => result.status === "rejected");
        if (cancelled || failed) {
          registered.forEach((cleanup) => cleanup());
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
      } catch (error) {
        logError("quick", "setup error", error);
      }
    })();
    return () => {
      cancelled = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      if (readyReported) void quickFrontendReady(false).catch(() => {});
      void emit("translation-state", { state: "idle" }).catch(() => {});
    };
  }, [handleStreamChunk, handleStreamDone, reset, translateText]);
  return { ...session, translateText };
}
