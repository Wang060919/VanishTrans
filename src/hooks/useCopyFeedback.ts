import { useCallback, useEffect, useRef, useState } from "react";
import { writeClipboardSafe } from "../services/tauriBridge";

/**
 * Copy text to the clipboard and expose which key was last copied,
 * so the triggering button can show transient "已复制" feedback.
 * Returns false instead of throwing when the copy fails.
 */
export function useCopyFeedback<K = string>(resetDelay = 1200) {
  const [copiedKey, setCopiedKey] = useState<K | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const copy = useCallback(
    async (key: K, text: string) => {
      if (!text) return false;
      try {
        await writeClipboardSafe({ text });
      } catch {
        return false;
      }
      setCopiedKey(key);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedKey(null), resetDelay);
      return true;
    },
    [resetDelay]
  );

  return { copiedKey, copy };
}
