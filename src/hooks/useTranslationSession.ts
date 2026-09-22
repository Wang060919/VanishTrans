import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { errorMessage, isCancelledError } from "../lib/errors";
import { generateTranslationKey, TranslationRequestLifecycle } from "../lib/translationState";

export type LangDirection = "auto" | "auto2zh" | "auto2en" | "zh2en" | "en2zh";
export type TranslationKind = "text" | "stream" | "file";
const initialState = {
  inputText: "", outputText: "", loading: false, streaming: false,
  glowActive: false, translationKey: 0,
  translationError: null as string | null,
  fileStatus: null as string | null,
};
type SessionState = typeof initialState;
function broadcast(state: "working" | "done" | "error" | "idle") {
  void emit("translation-state", { state }).catch(() => {});
}

/** Sole owner of result/error/loading state. Async callers commit with their request ID. */
export function useTranslationSession(initialSequence = 0) {
  const lifecycle = useRef(new TranslationRequestLifecycle(initialSequence)).current;
  const current = useRef(initialState);
  const [state, setState] = useState(initialState);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patch = useCallback((next: Partial<SessionState>) => {
    current.current = { ...current.current, ...next };
    setState(current.current);
  }, []);
  const clearStatusTimer = useCallback(() => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = null;
  }, []);
  const begin = useCallback((kind: TranslationKind) => {
    clearStatusTimer();
    const requestId = lifecycle.begin();
    patch({ outputText: "", translationError: null, fileStatus: null,
      loading: true, streaming: kind === "stream", glowActive: false });
    broadcast("working");
    return requestId;
  }, [clearStatusTimer, lifecycle, patch]);
  const complete = useCallback((requestId: number, outputText: string, fileStatus: string | null = null) => {
    // IPC return and done event can arrive in either order; only the first commits.
    if (!lifecycle.complete(requestId)) return;
    patch({ outputText, loading: false, streaming: false, glowActive: true,
      translationKey: generateTranslationKey(), fileStatus });
    broadcast("done");
    if (fileStatus) {
      statusTimer.current = setTimeout(() => {
        if (lifecycle.isCurrent(requestId)) patch({ fileStatus: null });
      }, 3000);
    }
  }, [lifecycle, patch]);
  const fail = useCallback((requestId: number, reason: unknown) => {
    if (!lifecycle.complete(requestId)) return;
    const cancelled = isCancelledError(reason);
    patch({ loading: false, streaming: false, glowActive: false, fileStatus: null,
      outputText: cancelled ? current.current.outputText : "",
      translationError: cancelled
        ? (current.current.outputText ? "翻译已取消，已保留部分译文" : "翻译已取消")
        : errorMessage(reason) || "翻译失败，请重试" });
    broadcast(cancelled ? "idle" : "error");
  }, [lifecycle, patch]);
  const cancel = useCallback(() => {
    lifecycle.invalidate();
    clearStatusTimer();
    patch({ loading: false, streaming: false, glowActive: false, fileStatus: null,
      translationError: current.current.outputText ? "翻译已取消，已保留部分译文" : "翻译已取消" });
    broadcast("idle");
  }, [clearStatusTimer, lifecycle, patch]);
  const reset = useCallback((message: string | null = null) => {
    lifecycle.invalidate();
    clearStatusTimer();
    patch({ ...initialState, translationError: message });
    broadcast(message ? "error" : "idle");
  }, [clearStatusTimer, lifecycle, patch]);
  const setInputText = useCallback((inputText: string) => patch({ inputText }), [patch]);
  const setFileStatus = useCallback((requestId: number, fileStatus: string) => {
    if (lifecycle.acceptsResult(requestId)) patch({ fileStatus });
  }, [lifecycle, patch]);
  const handleStreamChunk = useCallback((payload: { requestId: number; chunk: string }) => {
    if (lifecycle.acceptsResult(payload.requestId)) {
      patch({ outputText: current.current.outputText + payload.chunk });
    }
  }, [lifecycle, patch]);
  const handleStreamDone = useCallback((payload: { requestId: number; fullText: string }) => {
    complete(payload.requestId, payload.fullText);
  }, [complete]);
  const clearGlow = useCallback(() => patch({ glowActive: false }), [patch]);
  useEffect(() => () => {
    lifecycle.invalidate();
    clearStatusTimer();
  }, [clearStatusTimer, lifecycle]);
  return { ...state, lifecycle, begin, complete, fail, cancel, reset,
    setInputText, setFileStatus, clearGlow, handleStreamChunk, handleStreamDone };
}
export type TranslationSession = ReturnType<typeof useTranslationSession>;
