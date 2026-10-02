import { useCallback, useEffect, useRef, useState } from "react";
import { cancelTranslation as cancelTranslationCmd } from "../services/tauriBridge";
import { useTranslationSession, type LangDirection } from "./useTranslationSession";
import { useTextTranslation } from "./useTextTranslation";
import { useFileTranslation } from "./useFileTranslation";
import type { IslandResult } from "../lib/translationResult";
export type { LangDirection } from "./useTranslationSession";

/** Composes operations around one window-local session; operations never own result state. */
export function useTranslation(resultToOpen?: IslandResult | null) {
  const session = useTranslationSession();
  const [direction, setDirection] = useState<LangDirection>("auto");
  const directionRef = useRef(direction);
  const updateDirection = useCallback((next: LangDirection) => {
    directionRef.current = next;
    setDirection(next);
  }, []);
  const { restoreResult } = session;
  const restoredResult = useRef<IslandResult | null>(null);
  useEffect(() => {
    if (!resultToOpen || restoredResult.current === resultToOpen) return;
    restoredResult.current = resultToOpen;
    updateDirection(resultToOpen.direction);
    restoreResult(resultToOpen);
  }, [resultToOpen, restoreResult, updateDirection]);
  const text = useTextTranslation(session, directionRef);
  const file = useFileTranslation(session, directionRef, text.doTranslateFileText);
  const { cancel, reset } = session;
  const cancelTranslation = useCallback(async () => {
    cancel();
    await cancelTranslationCmd().catch(() => {});
  }, [cancel]);
  const resetTranslation = useCallback((message: string | null = null) => {
    reset(message);
    void cancelTranslationCmd().catch(() => {});
  }, [reset]);
  return { ...session, ...text, ...file, direction, updateDirection,
    cancelTranslation, resetTranslation };
}
