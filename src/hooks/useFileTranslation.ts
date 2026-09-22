import { useCallback, type RefObject } from "react";
import { translateBatch, translateWithDirection } from "../services/tauriBridge";
import { isSegmentCountMismatch } from "../lib/errors";
import { detectFileType, MAX_TRANSLATION_CHARS } from "../lib/fileParser";
import { countChars } from "../lib/textUtils";
import { prepareTranslationFile } from "../lib/translationFile";
import type { LangDirection, TranslationSession } from "./useTranslationSession";

export function useFileTranslation(
  { begin, lifecycle, setInputText, setFileStatus, complete, fail }: TranslationSession,
  direction: RefObject<LangDirection>,
  doTranslateStream: (text: string) => Promise<void>,
) {
  const doTranslateFile = useCallback(async (filename: string, content: string) => {
    if (detectFileType(filename) === "txt" && content.trim()
      && countChars(content) <= MAX_TRANSLATION_CHARS) {
      await doTranslateStream(content);
      return;
    }
    const requestId = begin("file");
    const requestedDirection = direction.current ?? "auto";
    try {
      setInputText(content);
      if (detectFileType(filename) === "txt") {
        throw new Error(content.trim()
          ? `文件内容过长（${countChars(content).toLocaleString()} 字符），最多支持 ${MAX_TRANSLATION_CHARS.toLocaleString()} 字符`
          : "文件中没有可翻译的文本");
      }
      const { segments, rebuild } = prepareTranslationFile(filename, content);
      setFileStatus(requestId, `解析到 ${segments.length} 段文本，翻译中...`);
      try {
        const translated = await translateBatch({ segments, direction: requestedDirection });
        if (!lifecycle.acceptsResult(requestId)) return;
        complete(requestId, rebuild(translated), `${filename} 翻译完成`);
      } catch (error) {
        if (!lifecycle.acceptsResult(requestId)) return;
        if (!isSegmentCountMismatch(error)) throw error;
        const raw = await translateWithDirection({
          text: segments.join("\n\n"), direction: requestedDirection,
        });
        complete(requestId, raw, `${filename} 结构丢失，已显示纯文本结果`);
      }
    } catch (error) {
      fail(requestId, error);
    }
  }, [begin, complete, direction, doTranslateStream, fail, lifecycle, setFileStatus, setInputText]);
  return { doTranslateFile };
}
