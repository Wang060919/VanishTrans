import { useCallback, useRef, useState } from "react";
import { cancelTranslation as cancelTranslationCmd } from "../services/tauriBridge";
import { useTranslationSession, type LangDirection } from "./useTranslationSession";
import { useTextTranslation } from "./useTextTranslation";
import { useFileTranslation } from "./useFileTranslation";
export type { LangDirection } from "./useTranslationSession";

/** Composes operations around one window-local session; operations never own result state. */
export function useTranslation() {
  const session = useTranslationSession();
  const [direction, setDirection] = useState<LangDirection>("auto");
  const directionRef = useRef(direction);
  const updateDirection = useCallback((next: LangDirection) => {
    directionRef.current = next;
    setDirection(next);
  }, []);
  const text = useTextTranslation(session, directionRef);
  const file = useFileTranslation(session, directionRef, text.doTranslateStream);
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
