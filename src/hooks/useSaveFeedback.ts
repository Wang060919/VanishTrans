import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * Shared "saved / save failed" feedback state for settings panels.
 * notifySaved shows a transient tick; notifyError pins the message
 * until the next successful save.
 */
export function useSaveFeedback(resetDelay = 1000) {
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const notifySaved = useCallback(() => {
    setSaveError("");
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), resetDelay);
  }, [resetDelay]);

  const notifyError = useCallback((error: unknown) => {
    setSaved(false);
    setSaveError(errorMessage(error) || "保存失败，请重试");
  }, []);

  const clearError = useCallback(() => setSaveError(""), []);

  return { saved, saveError, notifySaved, notifyError, clearError };
}
