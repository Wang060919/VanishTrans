import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";

/** Feedback for queued writes; failures remain visible until a successful batch. */
export function useSaveFeedback(resetDelay = 2500) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const pending = useRef(0);
  const batchFailed = useRef(false);
  const mounted = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const notifySaved = useCallback(() => {
    if (!mounted.current) return;
    setSaveError("");
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), resetDelay);
  }, [resetDelay]);

  const notifyError = useCallback((error: unknown) => {
    if (!mounted.current) return;
    batchFailed.current = true;
    setSaved(false);
    setSaveError(errorMessage(error) || "保存失败，请重试");
  }, []);

  const trackSave = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (pending.current === 0) batchFailed.current = false;
    pending.current += 1;
    if (mounted.current) { setSaving(true); setSaved(false); }
    try {
      return await operation();
    } catch (error) {
      notifyError(error);
      throw error;
    } finally {
      pending.current -= 1;
      if (mounted.current && pending.current === 0) {
        setSaving(false);
        if (!batchFailed.current) notifySaved();
      }
    }
  }, [notifyError, notifySaved]);

  const clearError = useCallback(() => setSaveError(""), []);
  return { saved, saving, saveError, notifySaved, notifyError, clearError, trackSave };
}
