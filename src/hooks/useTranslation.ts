import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useRef, useState, type SetStateAction } from "react";
import {
  errorMessage,
  isCancelledError,
  isSegmentCountMismatch,
} from "../lib/errors";
import {
  detectFileType,
  parseSrt,
  rebuildSrt,
  parseJson,
  rebuildJson,
  MAX_TRANSLATION_CHARS,
} from "../lib/fileParser";

export interface TranslateState {
  inputText: string;
  outputText: string;
  loading: boolean;
  glowActive: boolean;
  streaming: boolean;
}

export type LangDirection = "auto" | "auto2zh" | "auto2en" | "zh2en" | "en2zh";

/** Monotonically increasing id so Typewriter re-mounts on new translations. */
let translationIdCounter = 0;

type TranslationActivityState = "working" | "done" | "error" | "idle";

function broadcastTranslationActivity(state: TranslationActivityState) {
  void emit("translation-state", { state }).catch(() => {});
}

export function useTranslation() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputTextState] = useState("");
  const [loading, setLoading] = useState(false);
  const [glowActive, setGlowActive] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [direction, setDirection] = useState<LangDirection>("auto");
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [translationKey, setTranslationKey] = useState(0);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const directionRef = useRef(direction);
  const requestIdRef = useRef(0);
  const completedRequestIdRef = useRef<number | null>(null);
  const outputTextRef = useRef("");

  // Keep a synchronous copy for cancellation, which can occur between stream chunks.
  const setOutputText = useCallback((nextValue: SetStateAction<string>) => {
    const nextText = typeof nextValue === "function"
      ? (nextValue as (current: string) => string)(outputTextRef.current)
      : nextValue;
    outputTextRef.current = nextText;
    setOutputTextState(nextText);
  }, []);

  // Keep ref in sync
  const updateDirection = useCallback((d: LangDirection) => {
    directionRef.current = d;
    setDirection(d);
  }, []);

  const doTranslate = useCallback(async (text: string, forceRefresh = false) => {
    if (!text.trim()) return;
    const reqId = ++requestIdRef.current;
    completedRequestIdRef.current = null;
    setOutputText("");
    setTranslationError(null);
    setLoading(true);
    setStreaming(false);
    setGlowActive(false);
    try {
      const cleaned = await invoke<string>("cleanup_clipboard_text", { text });
      if (reqId !== requestIdRef.current) return;
      setInputText(cleaned);
      const result = await invoke<string>("translate_with_direction", {
        text: cleaned,
        direction: directionRef.current,
        forceRefresh,
      });
      if (reqId === requestIdRef.current) {
        setOutputText(result);
        setTranslationKey(++translationIdCounter);
        setGlowActive(true);
      }
    } catch (e: unknown) {
      if (reqId !== requestIdRef.current) return;
      if (isCancelledError(e)) {
        setTranslationError(outputTextRef.current
          ? "翻译已取消，已保留部分译文"
          : "翻译已取消");
        broadcastTranslationActivity("idle");
      } else {
        setTranslationError(errorMessage(e) || "翻译失败，请重试");
        broadcastTranslationActivity("error");
      }
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [setOutputText]);

  /// Streaming translation — emits chunks via Tauri events.
  const doTranslateStream = useCallback(async (text: string, forceRefresh = false) => {
    if (!text.trim()) return;
    const reqId = ++requestIdRef.current;
    completedRequestIdRef.current = null;
    setOutputText("");
    setTranslationError(null);
    setLoading(true);
    setStreaming(true);
    setGlowActive(false);
    broadcastTranslationActivity("working");
    try {
      const cleaned = await invoke<string>("cleanup_clipboard_text", { text });
      if (reqId !== requestIdRef.current) return;
      setInputText(cleaned);
      await invoke<string>("translate_stream", {
        request: {
          text: cleaned,
          direction: directionRef.current,
          requestId: reqId,
          forceRefresh,
        },
      });
      // Stream done — finalize
      if (reqId === requestIdRef.current) {
        setStreaming(false);
        setTranslationKey(++translationIdCounter);
        setGlowActive(true);
        broadcastTranslationActivity("done");
      }
    } catch (e: unknown) {
      if (reqId !== requestIdRef.current) return;
      if (isCancelledError(e)) {
        setTranslationError(outputTextRef.current
          ? "翻译已取消，已保留部分译文"
          : "翻译已取消");
        setStreaming(false);
        broadcastTranslationActivity("idle");
      } else {
        setTranslationError(errorMessage(e) || "翻译失败，请重试");
        setStreaming(false);
        broadcastTranslationActivity("error");
      }
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [setOutputText]);

  /// Called by useTauriEvents when a stream chunk arrives.
  const handleStreamChunk = useCallback((payload: { requestId: number; chunk: string }) => {
    if (payload.requestId !== requestIdRef.current || payload.requestId === completedRequestIdRef.current) return;
    setOutputText((prev) => prev + payload.chunk);
  }, [setOutputText]);

  /// Called by useTauriEvents when stream is complete.
  const handleStreamDone = useCallback((payload: { requestId: number; fullText: string }) => {
    if (payload.requestId !== requestIdRef.current) return;
    completedRequestIdRef.current = payload.requestId;
    // Chunks can be delayed or coalesced, so the authoritative final payload
    // replaces the incremental display instead of merely marking it complete.
    setOutputText(payload.fullText);
    setStreaming(false);
  }, [setOutputText]);

  const cancelTranslation = useCallback(async () => {
    // Invalidate the local request before the native command returns so late
    // chunks and completion events cannot overwrite the preserved text.
    ++requestIdRef.current;
    setLoading(false);
    setStreaming(false);
    setGlowActive(false);
    setFileStatus(null);
    setTranslationError(outputTextRef.current
      ? "翻译已取消，已保留部分译文"
      : "翻译已取消");
    broadcastTranslationActivity("idle");

    try {
      await invoke("cancel_translation");
    } catch {
      // Local invalidation still prevents stale output when the native command
      // is unavailable, such as in the browser preview.
    }
  }, []);

  const clearGlow = useCallback(() => setGlowActive(false), []);

  /// Handle file drag-and-drop: parse structured files, translate, reassemble.
  const doTranslateFile = useCallback(async (filename: string, content: string) => {
    const fileType = detectFileType(filename);
    const contentLength = Array.from(content).length;
    setTranslationError(null);

    if (fileType === "txt" && contentLength > MAX_TRANSLATION_CHARS) {
      setOutputText(`❌ 文件内容过长（${contentLength.toLocaleString()} 字符），最多支持 ${MAX_TRANSLATION_CHARS.toLocaleString()} 字符`);
      setLoading(false);
      setStreaming(false);
      setFileStatus(null);
      return;
    }

    if (fileType === "txt") {
      setFileStatus(`${filename} 翻译中...`);
      await doTranslateStream(content);
      setFileStatus(null);
      return;
    }

    const reqId = ++requestIdRef.current;
    const statusTimeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    // Structured file (.srt / .json): parse → extract → batch translate → reassemble
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
        segments = blocks.map((b) => b.text);
        reassemble = (translated) => {
          const newBlocks = blocks.map((b, i) => ({
            ...b,
            text: translated[i] ?? b.text,
          }));
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

      const batchLength = Array.from(segments.join("\n\n===SEGMENT_BREAK===\n\n")).length;
      if (batchLength > MAX_TRANSLATION_CHARS) {
        setOutputText(`❌ 文件内容过长（批处理共 ${batchLength.toLocaleString()} 字符），最多支持 ${MAX_TRANSLATION_CHARS.toLocaleString()} 字符`);
        setLoading(false);
        setFileStatus(null);
        return;
      }

      // Batch translate all segments at once
      try {
        const translated = await invoke<string[]>("translate_batch", {
          segments,
          direction: directionRef.current,
        });

        if (reqId !== requestIdRef.current) return;

        const result = reassemble(translated);
        setInputText(content);
        setOutputText(result);
        setTranslationKey(++translationIdCounter);
        setGlowActive(true);
        setFileStatus(`${filename} 翻译完成`);
        statusTimeoutRef.current = setTimeout(() => {
          if (reqId === requestIdRef.current) setFileStatus(null);
        }, 3000);
      } catch (batchErr: unknown) {
        if (reqId !== requestIdRef.current) return;
        if (isSegmentCountMismatch(batchErr)) {
          // Model didn't split correctly — show raw result as plain text
          const rawResult = await invoke<string>("translate_with_direction", {
            text: segments.join("\n\n"),
            direction: directionRef.current,
          });
          if (reqId === requestIdRef.current) {
            setOutputText(rawResult);
            setTranslationKey(++translationIdCounter);
            setFileStatus(`${filename} 结构丢失，已显示纯文本结果`);
            statusTimeoutRef.current = setTimeout(() => {
              if (reqId === requestIdRef.current) setFileStatus(null);
            }, 3000);
          }
        } else {
          throw batchErr; // Re-throw for outer catch
        }
      }
    } catch (e: unknown) {
      if (reqId === requestIdRef.current) {
        setOutputText(`❌ 文件翻译失败: ${errorMessage(e)}`);
        setFileStatus(null);
      }
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }

    // Cleanup timeout on unmount or when reqId changes
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, [doTranslateStream, setOutputText]);

  return {
    inputText, setInputText,
    outputText, setOutputText,
    loading, setLoading,
    translationError, setTranslationError,
    glowActive, clearGlow,
    streaming,
    direction, updateDirection,
    fileStatus,
    translationKey,
    doTranslate,
    doTranslateStream,
    cancelTranslation,
    doTranslateFile,
    handleStreamChunk,
    handleStreamDone,
  };
}
