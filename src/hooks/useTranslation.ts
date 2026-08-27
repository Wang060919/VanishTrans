import {
  cancelTranslation as cancelTranslationCmd,
  cleanupClipboardText,
  translateWithDirection,
  translateStream,
} from "../services/tauriBridge";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useRef, useState, type SetStateAction } from "react";
import { errorMessage, isCancelledError } from "../lib/errors";
import {
  createRequestId,
  isCurrentRequest,
  generateTranslationKey,
  invalidateCurrentRequest,
} from "../lib/translationState";
import { useFileTranslation } from "./useFileTranslation";
import { useStreamHandlers } from "./useStreamHandlers";

export interface TranslateState {
  inputText: string;
  outputText: string;
  loading: boolean;
  glowActive: boolean;
  streaming: boolean;
}

export type LangDirection = "auto" | "auto2zh" | "auto2en" | "zh2en" | "en2zh";

type TranslationActivityState = "working" | "done" | "error" | "idle";

function broadcastTranslationActivity(state: TranslationActivityState) {
  void emit("translation-state", { state }).catch(() => {});
}

/**
 * Core translation hook - manages translation state and orchestrates operations.
 * Single responsibility: coordinate translation requests and state updates.
 */
export function useTranslation() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputTextState] = useState("");
  const [loading, setLoading] = useState(false);
  const [glowActive, setGlowActive] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [direction, setDirection] = useState<LangDirection>("auto");
  const [translationKey, setTranslationKey] = useState(0);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const directionRef = useRef(direction);
  const requestIdRef = useRef(0);
  const completedRequestIdRef = useRef<number | null>(null);
  const outputTextRef = useRef("");

  // Synchronous setter for cancellation safety
  const setOutputText = useCallback((nextValue: SetStateAction<string>) => {
    const nextText =
      typeof nextValue === "function"
        ? (nextValue as (current: string) => string)(outputTextRef.current)
        : nextValue;
    outputTextRef.current = nextText;
    setOutputTextState(nextText);
  }, []);

  // Keep direction ref in sync
  const updateDirection = useCallback((d: LangDirection) => {
    directionRef.current = d;
    setDirection(d);
  }, []);

  // Standard (non-streaming) translation
  const doTranslate = useCallback(
    async (text: string, forceRefresh = false) => {
      if (!text.trim()) return;
      const reqId = createRequestId(requestIdRef);
      completedRequestIdRef.current = null;
      setOutputText("");
      setTranslationError(null);
      setLoading(true);
      setStreaming(false);
      setGlowActive(false);

      try {
        const cleaned = await cleanupClipboardText({ text });
        if (!isCurrentRequest(reqId, requestIdRef)) return;

        setInputText(cleaned);
        const result = await translateWithDirection({
          text: cleaned,
          direction: directionRef.current,
          forceRefresh,
        });

        if (isCurrentRequest(reqId, requestIdRef)) {
          setOutputText(result);
          setTranslationKey(generateTranslationKey());
          setGlowActive(true);
        }
      } catch (e: unknown) {
        if (!isCurrentRequest(reqId, requestIdRef)) return;

        if (isCancelledError(e)) {
          setTranslationError(
            outputTextRef.current ? "翻译已取消，已保留部分译文" : "翻译已取消"
          );
          broadcastTranslationActivity("idle");
        } else {
          setTranslationError(errorMessage(e) || "翻译失败，请重试");
          broadcastTranslationActivity("error");
        }
      } finally {
        if (isCurrentRequest(reqId, requestIdRef)) setLoading(false);
      }
    },
    [setOutputText]
  );

  // Streaming translation
  const doTranslateStream = useCallback(
    async (text: string, forceRefresh = false) => {
      if (!text.trim()) return;
      const reqId = createRequestId(requestIdRef);
      completedRequestIdRef.current = null;
      setOutputText("");
      setTranslationError(null);
      setLoading(true);
      setStreaming(true);
      setGlowActive(false);
      broadcastTranslationActivity("working");

      try {
        const cleaned = await cleanupClipboardText({ text });
        if (!isCurrentRequest(reqId, requestIdRef)) return;

        setInputText(cleaned);
        await translateStream({
          text: cleaned,
          direction: directionRef.current,
          requestId: reqId,
          forceRefresh,
        });

        // Stream finalization
        if (isCurrentRequest(reqId, requestIdRef)) {
          setStreaming(false);
          setTranslationKey(generateTranslationKey());
          setGlowActive(true);
          broadcastTranslationActivity("done");
        }
      } catch (e: unknown) {
        if (!isCurrentRequest(reqId, requestIdRef)) return;

        if (isCancelledError(e)) {
          setTranslationError(
            outputTextRef.current ? "翻译已取消，已保留部分译文" : "翻译已取消"
          );
          setStreaming(false);
          broadcastTranslationActivity("idle");
        } else {
          setTranslationError(errorMessage(e) || "翻译失败，请重试");
          setStreaming(false);
          broadcastTranslationActivity("error");
        }
      } finally {
        if (isCurrentRequest(reqId, requestIdRef)) setLoading(false);
      }
    },
    [setOutputText]
  );

  // Cancel active translation
  const cancelTranslation = useCallback(async () => {
    // Invalidate request immediately to prevent stale updates
    invalidateCurrentRequest(requestIdRef);
    setLoading(false);
    setStreaming(false);
    setGlowActive(false);
    setTranslationError(
      outputTextRef.current ? "翻译已取消，已保留部分译文" : "翻译已取消"
    );
    broadcastTranslationActivity("idle");

    try {
      await cancelTranslationCmd();
    } catch {
      // Local invalidation prevents stale output regardless
    }
  }, []);

  const clearGlow = useCallback(() => setGlowActive(false), []);

  // Stream event handlers
  const { handleStreamChunk, handleStreamDone } = useStreamHandlers({
    requestIdRef,
    completedRequestIdRef,
    setOutputText,
    setStreaming,
  });

  // File translation logic
  const { fileStatus, doTranslateFile } = useFileTranslation({
    directionRef,
    requestIdRef,
    setInputText,
    setOutputText,
    setLoading,
    setStreaming,
    setGlowActive,
    setTranslationKey,
    doTranslateStream,
  });

  return {
    // State
    inputText,
    setInputText,
    outputText,
    setOutputText,
    loading,
    setLoading,
    translationError,
    setTranslationError,
    glowActive,
    clearGlow,
    streaming,
    direction,
    updateDirection,
    fileStatus,
    translationKey,

    // Actions
    doTranslate,
    doTranslateStream,
    cancelTranslation,
    doTranslateFile,
    handleStreamChunk,
    handleStreamDone,
  };
}
