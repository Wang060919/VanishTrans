import { useCallback, type RefObject } from "react";
import { cleanupClipboardText, translateStream, translateWithDirection } from "../services/tauriBridge";
import type { LangDirection, TranslationSession } from "./useTranslationSession";

export function useTextTranslation(
  { begin, waitForQuickClaim, lifecycle, setInputText, setRequestSource, complete, fail }: TranslationSession,
  direction: RefObject<LangDirection>,
) {
  const translate = useCallback(async (text: string, streaming: boolean,
    { forceRefresh = false, preserveText = false }: { forceRefresh?: boolean; preserveText?: boolean } = {}) => {
    if (!text.trim()) return;
    const requestId = begin(streaming ? "stream" : "text");
    const requestedDirection = direction.current ?? "auto";
    try {
      if (!await waitForQuickClaim(requestId)) return;
      const cleaned = preserveText ? text : await cleanupClipboardText({ text });
      if (!lifecycle.acceptsResult(requestId)) return;
      if (!cleaned.trim()) throw new Error("未读取到可翻译的文字");
      setInputText(cleaned);
      setRequestSource(requestId, cleaned, requestedDirection);
      const request = { text: cleaned, direction: requestedDirection, forceRefresh };
      const result = streaming
        ? await translateStream({ ...request, requestId })
        : await translateWithDirection(request);
      complete(requestId, result);
    } catch (error) {
      fail(requestId, error);
    }
  }, [begin, complete, direction, fail, lifecycle, setInputText, setRequestSource, waitForQuickClaim]);
  const doTranslateStream = useCallback((text: string, forceRefresh = false) =>
    translate(text, true, { forceRefresh }), [translate]);
  // File content goes to the backend verbatim: clipboard cleanup would silently
  // rewrite the file's text (merged hyphenation, trimmed whitespace).
  const doTranslateFileText = useCallback((text: string) =>
    translate(text, true, { preserveText: true }), [translate]);
  return { doTranslateStream, doTranslateFileText };
}
