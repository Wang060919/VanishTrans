import { useCallback, type RefObject } from "react";
import { cleanupClipboardText, translateStream, translateWithDirection } from "../services/tauriBridge";
import type { LangDirection, TranslationSession } from "./useTranslationSession";

export function useTextTranslation(
  { begin, lifecycle, setInputText, complete, fail }: TranslationSession,
  direction: RefObject<LangDirection>,
) {
  const translate = useCallback(async (text: string, streaming: boolean, forceRefresh = false) => {
    if (!text.trim()) return;
    const requestId = begin(streaming ? "stream" : "text");
    const requestedDirection = direction.current ?? "auto";
    try {
      const cleaned = await cleanupClipboardText({ text });
      if (!lifecycle.acceptsResult(requestId)) return;
      if (!cleaned.trim()) throw new Error("未读取到可翻译的文字");
      setInputText(cleaned);
      const request = { text: cleaned, direction: requestedDirection, forceRefresh };
      const result = streaming
        ? await translateStream({ ...request, requestId })
        : await translateWithDirection(request);
      complete(requestId, result);
    } catch (error) {
      fail(requestId, error);
    }
  }, [begin, complete, direction, fail, lifecycle, setInputText]);
  const doTranslate = useCallback((text: string, forceRefresh = false) =>
    translate(text, false, forceRefresh), [translate]);
  const doTranslateStream = useCallback((text: string, forceRefresh = false) =>
    translate(text, true, forceRefresh), [translate]);
  return { doTranslate, doTranslateStream };
}
