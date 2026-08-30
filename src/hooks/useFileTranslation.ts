import { useCallback, useRef, useState } from "react";
import { translateBatch, translateWithDirection } from "../services/tauriBridge";
import { errorMessage, isSegmentCountMismatch } from "../lib/errors";
import {
  detectFileType,
  parseSrt,
  rebuildSrt,
  parseJson,
  rebuildJson,
  MAX_TRANSLATION_CHARS,
} from "../lib/fileParser";
import { countChars } from "../lib/textUtils";
import { createRequestId, isCurrentRequest, generateTranslationKey } from "../lib/translationState";
import type { LangDirection } from "./useTranslation";

interface UseFileTranslationProps {
  directionRef: React.RefObject<LangDirection>;
  requestIdRef: React.MutableRefObject<number>;
  setInputText: (text: string) => void;
  setOutputText: (text: string) => void;
  setLoading: (loading: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setGlowActive: (active: boolean) => void;
  setTranslationKey: (key: number) => void;
  doTranslateStream: (text: string, forceRefresh?: boolean) => Promise<void>;
}

/**
 * Hook for handling file translation (SRT, JSON, TXT).
 * Single responsibility: file parsing, batch translation, reassembly.
 */
export function useFileTranslation({
  directionRef,
  requestIdRef,
  setInputText,
  setOutputText,
  setLoading,
  setStreaming,
  setGlowActive,
  setTranslationKey,
  doTranslateStream,
}: UseFileTranslationProps) {
  const [fileStatus, setFileStatus] = useState<string | null>(null);

  const operationRef = useRef(0);
  const doTranslateFile = useCallback(
    async (filename: string, content: string) => {
      const operationId = ++operationRef.current;
      const reqId = createRequestId(requestIdRef);
      const isCurrentOperation = () => operationRef.current === operationId;
      // A new file operation supersedes any in-flight text or file translation.
      setLoading(false);
      setStreaming(false);
      setGlowActive(false);
      const fileType = detectFileType(filename);
      const contentLength = countChars(content);

      // Plain text file: use streaming translation
      if (fileType === "txt") {
        if (contentLength > MAX_TRANSLATION_CHARS) {
          setOutputText(
            `❌ 文件内容过长（${contentLength.toLocaleString()} 字符），最多支持 ${MAX_TRANSLATION_CHARS.toLocaleString()} 字符`
          );
          setLoading(false);
          setStreaming(false);
          setFileStatus(null);
          return;
        }
        setFileStatus(`${filename} 翻译中...`);
        await doTranslateStream(content);
        if (isCurrentOperation()) setFileStatus(null);
        return;
      }

      // Structured files (SRT/JSON): batch translation
      const statusTimeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

      setFileStatus(`正在解析 ${filename}...`);
      setLoading(true);
      setOutputText("");

      try {
        let segments: string[];
        let reassemble: (translated: string[]) => string;

        if (fileType === "srt") {
          const blocks = parseSrt(content);
          if (blocks.length === 0) {
            setOutputText("❌ 未找到有效的字幕块");
            setLoading(false);
            setFileStatus(null);
            return;
          }
          const translatableBlocks = blocks.filter((block) => block.text.trim());
          segments = translatableBlocks.map((block) => block.text);
          reassemble = (translated) => {
            let translatedIndex = 0;
            const newBlocks = blocks.map((block) => {
              if (!block.text.trim()) return block;
              const nextText = translated[translatedIndex++] ?? block.text;
              return { ...block, text: nextText };
            });
            return rebuildSrt(newBlocks);
          };
          setFileStatus(`解析到 ${segments.length} 条字幕，翻译中...`);
        } else if (fileType === "json") {
          const jsonSegments = parseJson(content);
          if (jsonSegments.length === 0) {
            setOutputText("❌ JSON 中没有可翻译的文本");
            setLoading(false);
            setFileStatus(null);
            return;
          }
          segments = jsonSegments.map((s) => s.text);
          reassemble = (translated) => {
            const map = new Map<string, string>();
            jsonSegments.forEach((s, i) => {
              if (translated[i] !== undefined) map.set(s.path, translated[i]);
            });
            return rebuildJson(content, map);
          };
          setFileStatus(`解析到 ${segments.length} 段文本，翻译中...`);
        } else {
          setOutputText(`❌ 不支持的文件类型: ${filename}`);
          setLoading(false);
          setFileStatus(null);
          return;
        }

        // Check batch length limit
        const batchLength = countChars(segments.join("\n\n===SEGMENT_BREAK===\n\n"));
        if (batchLength > MAX_TRANSLATION_CHARS) {
          setOutputText(
            `❌ 文件内容过长（批处理共 ${batchLength.toLocaleString()} 字符），最多支持 ${MAX_TRANSLATION_CHARS.toLocaleString()} 字符`
          );
          setLoading(false);
          setFileStatus(null);
          return;
        }

        // Batch translate all segments
        try {
          const translated = await translateBatch({
            segments,
            direction: directionRef.current!,
          });

          if (!isCurrentRequest(reqId, requestIdRef)) return;

          const result = reassemble(translated);
          setInputText(content);
          setOutputText(result);
          setTranslationKey(generateTranslationKey());
          setGlowActive(true);
          setFileStatus(`${filename} 翻译完成`);
          statusTimeoutRef.current = setTimeout(() => {
            if (isCurrentRequest(reqId, requestIdRef)) setFileStatus(null);
          }, 3000);
        } catch (batchErr: unknown) {
          if (!isCurrentRequest(reqId, requestIdRef)) return;

          // Handle segment count mismatch: fall back to plain text
          if (isSegmentCountMismatch(batchErr)) {
            const rawResult = await translateWithDirection({
              text: segments.join("\n\n"),
              direction: directionRef.current!,
            });
            if (isCurrentRequest(reqId, requestIdRef)) {
              setOutputText(rawResult);
              setTranslationKey(generateTranslationKey());
              setFileStatus(`${filename} 结构丢失，已显示纯文本结果`);
              statusTimeoutRef.current = setTimeout(() => {
                if (isCurrentRequest(reqId, requestIdRef)) setFileStatus(null);
              }, 3000);
            }
          } else {
            throw batchErr;
          }
        }
      } catch (e: unknown) {
        if (isCurrentRequest(reqId, requestIdRef)) {
          setOutputText(`❌ 文件翻译失败: ${errorMessage(e)}`);
          setFileStatus(null);
        }
      } finally {
        if (isCurrentRequest(reqId, requestIdRef)) setLoading(false);
      }
    },
    [
      directionRef,
      requestIdRef,
      setInputText,
      setOutputText,
      setLoading,
      setStreaming,
      setGlowActive,
      setTranslationKey,
      doTranslateStream,
    ]
  );

  return {
    fileStatus,
    doTranslateFile,
  };
}
