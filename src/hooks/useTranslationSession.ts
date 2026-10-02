import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { cancelTranslation as cancelTranslationCmd, revealQuickResult as revealQuickResultCmd } from "../services/tauriBridge";
import type { TranslationResult } from "../lib/translationResult";
import { errorMessage, isCancelledError } from "../lib/errors";
import { logError } from "../lib/logger";
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
type QuickResultPayload = { source: string; text: string; requestSeq: number };

/** Sole owner of result/error/loading state. Async callers commit with their request ID. */
export function useTranslationSession(initialSequence = 0,
  reserveQuickRequest?: () => Promise<number>, scope = "main") {
  const lifecycle = useRef(new TranslationRequestLifecycle(initialSequence)).current;
  const [sourceId] = useState(() => `${scope}:${crypto.randomUUID()}`);
  const revision = useRef(0);
  const requestSource = useRef<{ source: string; direction: LangDirection } | null>(null);
  const broadcast = useCallback((state: "working" | "done" | "error" | "idle", result?: TranslationResult) => {
    void emit("translation-state", {
      state, sourceId, requestId: lifecycle.requestId, revision: ++revision.current,
      ...(result ? { result } : {}),
    }).catch(() => {});
  }, [lifecycle, sourceId]);
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
  // The native shortcut and quick-window user actions share one backend sequence.
  // While a claim is in flight a fallback cannot be ordered yet, so the newest
  // payload is deferred and decided when the pending claims settle.
  const latestQuickSequence = useRef(0);
  const pendingQuickClaims = useRef(0);
  const quickClaimFailed = useRef(false);
  const deferredQuickResult = useRef<QuickResultPayload | null>(null);
  const quickClaims = useRef(new Map<number, Promise<void>>());
  // Deferred applies reveal here; immediate ones reveal via the listener's return.
  const applyQuickResult = useCallback((payload: QuickResultPayload, deferred: boolean): boolean => {
    const seq = payload.requestSeq;
    if (!Number.isSafeInteger(seq) || seq <= 0 ||
        quickClaimFailed.current || seq <= latestQuickSequence.current) return false;
    const wasInFlight = lifecycle.acceptsResult(lifecycle.requestId);
    // A newer native result supersedes even an in-flight quick request; begin()
    // invalidates its chunks, done event, IPC return and error before displaying B.
    const requestId = lifecycle.begin();
    if (!lifecycle.complete(requestId)) return false;
    if (wasInFlight) void cancelTranslationCmd().catch(() => {});
    latestQuickSequence.current = seq;
    clearStatusTimer();
    patch({ inputText: payload.source, outputText: payload.text, translationError: null,
      fileStatus: null, loading: false, streaming: false, glowActive: true,
      translationKey: generateTranslationKey() });
    broadcast("done", { source: payload.source, text: payload.text, direction: "auto" });
    if (deferred) void revealQuickResultCmd({ requestSeq: seq }).catch((error: unknown) =>
      logError(scope, "failed to reveal accepted fallback", error));
    return true;
  }, [broadcast, clearStatusTimer, lifecycle, patch, scope]);
  const claimQuick = useCallback(() => {
    if (!reserveQuickRequest) return Promise.resolve();
    pendingQuickClaims.current++;
    // A reservation failure never fails the user's own request; it only latches
    // fail-closed for fallbacks until the next claim succeeds.
    return reserveQuickRequest().then((seq) => {
      latestQuickSequence.current = Math.max(latestQuickSequence.current, seq);
      quickClaimFailed.current = false;
    }).catch((error: unknown) => {
      quickClaimFailed.current = true; // Fail closed, never accept an unversioned fallback.
      logError(scope, "failed to reserve quick request", error);
    }).finally(() => {
      if (--pendingQuickClaims.current !== 0) return;
      const payload = deferredQuickResult.current;
      deferredQuickResult.current = null;
      if (payload) applyQuickResult(payload, true);
    });
  }, [applyQuickResult, reserveQuickRequest, scope]);
  const waitForQuickClaim = useCallback(async (requestId: number) => {
    const claim = quickClaims.current.get(requestId);
    try { if (claim) await claim; }
    finally { quickClaims.current.delete(requestId); }
    return lifecycle.acceptsResult(requestId);
  }, [lifecycle]);
  const begin = useCallback((kind: TranslationKind) => {
    clearStatusTimer();
    const requestId = lifecycle.begin();
    requestSource.current = null;
    if (reserveQuickRequest) quickClaims.current.set(requestId, claimQuick());
    patch({ outputText: "", translationError: null, fileStatus: null,
      loading: true, streaming: kind === "stream", glowActive: false });
    broadcast("working");
    return requestId;
  }, [broadcast, claimQuick, clearStatusTimer, lifecycle, patch, reserveQuickRequest]);
  const complete = useCallback((requestId: number, outputText: string, fileStatus: string | null = null) => {
    // IPC return and done event can arrive in either order; only the first commits.
    if (!lifecycle.complete(requestId)) return;
    patch({ outputText, loading: false, streaming: false, glowActive: true,
      translationKey: generateTranslationKey(), fileStatus });
    const source = requestSource.current;
    broadcast("done", source && !fileStatus ? { ...source, text: outputText } : undefined);
    if (fileStatus) {
      statusTimer.current = setTimeout(() => {
        if (lifecycle.isCurrent(requestId)) patch({ fileStatus: null });
      }, 3000);
    }
  }, [broadcast, lifecycle, patch]);
  const fail = useCallback((requestId: number, reason: unknown) => {
    if (!lifecycle.complete(requestId)) return;
    const cancelled = isCancelledError(reason);
    patch({ loading: false, streaming: false, glowActive: false, fileStatus: null,
      outputText: cancelled ? current.current.outputText : "",
      translationError: cancelled
        ? (current.current.outputText ? "翻译已取消，已保留部分译文" : "翻译已取消")
        : errorMessage(reason) || "翻译失败，请重试" });
    broadcast(cancelled ? "idle" : "error");
  }, [broadcast, lifecycle, patch]);
  const cancel = useCallback(() => {
    if (reserveQuickRequest) void claimQuick();
    // Only an in-flight request can report a cancellation; an idle cancel keeps
    // the previous error/result instead of fabricating "翻译已取消".
    const wasInFlight = lifecycle.acceptsResult(lifecycle.requestId);
    lifecycle.invalidate();
    clearStatusTimer();
    if (wasInFlight) patch({ loading: false, streaming: false, glowActive: false, fileStatus: null,
      translationError: current.current.outputText ? "翻译已取消，已保留部分译文" : "翻译已取消" });
    broadcast("idle");
  }, [broadcast, claimQuick, clearStatusTimer, lifecycle, patch, reserveQuickRequest]);
  const reset = useCallback((message: string | null = null) => {
    if (reserveQuickRequest) void claimQuick();
    lifecycle.invalidate();
    clearStatusTimer();
    patch({ ...initialState, translationError: message });
    broadcast(message ? "error" : "idle");
  }, [broadcast, claimQuick, clearStatusTimer, lifecycle, patch, reserveQuickRequest]);
  const setRequestSource = useCallback((requestId: number, source: string, direction: LangDirection) => {
    if (lifecycle.acceptsResult(requestId)) requestSource.current = { source, direction };
  }, [lifecycle]);
  const restoreResult = useCallback((result: TranslationResult) => {
    const requestId = lifecycle.begin();
    lifecycle.complete(requestId);
    clearStatusTimer();
    requestSource.current = { source: result.source, direction: result.direction };
    patch({ ...initialState, inputText: result.source, outputText: result.text,
      translationKey: generateTranslationKey() });
    broadcast("done", result);
  }, [broadcast, clearStatusTimer, lifecycle, patch]);
  const setInputText = useCallback((inputText: string) => patch({ inputText }), [patch]);
  const setFileStatus = useCallback((requestId: number, fileStatus: string) => {
    if (lifecycle.acceptsResult(requestId)) patch({ fileStatus });
  }, [lifecycle, patch]);
  const handleStreamChunk = useCallback((payload: { requestId: number; chunk: string }) => {
    if (lifecycle.acceptsResult(payload.requestId)) {
      patch({ outputText: current.current.outputText + payload.chunk });
    }
  }, [lifecycle, patch]);
  const applyExternalResult = useCallback((payload: QuickResultPayload): boolean => {
    const seq = payload.requestSeq;
    if (!Number.isSafeInteger(seq) || seq <= 0 ||
        quickClaimFailed.current || seq <= latestQuickSequence.current) return false;
    if (pendingQuickClaims.current > 0) {
      // Keep the newest payload; claim settling decides if it is still newer
      // than every reserved sequence.
      const deferred = deferredQuickResult.current;
      if (!deferred || seq > deferred.requestSeq) deferredQuickResult.current = payload;
      return false;
    }
    return applyQuickResult(payload, false);
  }, [applyQuickResult]);
  const handleStreamDone = useCallback((payload: { requestId: number; fullText: string }) => {
    complete(payload.requestId, payload.fullText);
  }, [complete]);
  const clearGlow = useCallback(() => patch({ glowActive: false }), [patch]);
  useEffect(() => () => {
    lifecycle.invalidate();
    clearStatusTimer();
    broadcast("idle");
  }, [broadcast, clearStatusTimer, lifecycle]);
  return { ...state, lifecycle, begin, waitForQuickClaim, complete, fail, cancel, reset,
    applyExternalResult, setRequestSource, restoreResult,
    setInputText, setFileStatus, clearGlow, handleStreamChunk, handleStreamDone };
}
export type TranslationSession = ReturnType<typeof useTranslationSession>;
