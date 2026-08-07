import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useRef, useState } from "react";
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
  const [outputText, setOutputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [glowActive, setGlowActive] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [direction, setDirection] = useState<LangDirection>("auto");
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [translationKey, setTranslationKey] = useState(0);

  const directionRef = useRef(direction);
  const requestIdRef = useRef(0);

  // Keep ref in sync
  const updateDirection = useCallback((d: LangDirection) => {
    directionRef.current = d;
    setDirection(d);
  }, []);

  const doTranslate = useCallback(async (text: string, forceRefresh = false) => {
    if (!text.trim()) return;
    const cleaned = await invoke<string>("cleanup_clipboard_text", { text });
    setInputText(cleaned);
    setOutputText("");
    setLoading(true);
    setStreaming(false);
    const reqId = ++requestIdRef.current;
    try {
      const result = await invoke<string>("translate_with_direction", {
        text: cleaned,
        direction: directionRef.current,
        forceRefresh,
      });
      if (reqId === requestIdRef.current) {
        setOutputText(result);
        setTranslationKey(++translationIdCounter);
        if (!result.startsWith("❌")) {
          setGlowActive(true);
        }
      }
    } catch (e: unknown) {
      if (isCancelledError(e)) {
        if (reqId === requestIdRef.current) setLoading(false);
        return;
      }
      if (reqId === requestIdRef.current) setOutputText(`❌ ${errorMessage(e)}`);
    }
    if (reqId === requestIdRef.current) setLoading(false);
  }, []);

  /// Streaming translation — emits chunks via Tauri events.
  const doTranslateStream = useCallback(async (text: string, forceRefresh = false) => {
    if (!text.trim()) return;
    const reqId = ++requestIdRef.current;
    broadcastTranslationActivity("working");
    try {
      const cleaned = await invoke<string>("cleanup_clipboard_text", { text });
      if (reqId !== requestIdRef.current) return;
      setInputText(cleaned);
      setOutputText("");
      setLoading(true);
      setStreaming(true);
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
      if (isCancelledError(e)) {
        if (reqId === requestIdRef.current) {
          setLoading(false);
          setStreaming(false);
          broadcastTranslationActivity("idle");
        }
        return;
      }
      if (reqId === requestIdRef.current) {
        setOutputText((previous) => previous
          ? `❌ ${errorMessage(e)}\n\n已接收的部分译文：\n${previous}`
          : `❌ ${errorMessage(e)}`);
        setStreaming(false);
        broadcastTranslationActivity("error");
      }
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, []);

  /// Called by useTauriEvents when a stream chunk arrives.
  const handleStreamChunk = useCallback((payload: { requestId: number; chunk: string }) => {
    if (payload.requestId !== requestIdRef.current) return;
    setOutputText((prev) => prev + payload.chunk);
  }, []);

  /// Called by useTauriEvents when stream is complete.
  const handleStreamDone = useCallback((payload: { requestId: number; fullText: string }) => {
    if (payload.requestId !== requestIdRef.current) return;
    setStreaming(false);
  }, []);

  const clearGlow = useCallback(() => setGlowActive(false), []);

  /// Handle file drag-and-drop: parse structured files, translate, reassemble.
  const doTranslateFile = useCallback(async (filename: string, content: string) => {
    const fileType = detectFileType(filename);
    const contentLength = Array.from(content).length;

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
  }, [doTranslateStream]);

  return {
    inputText, setInputText,
    outputText, setOutputText,
    loading, setLoading,
    glowActive, clearGlow,
    streaming,
    direction, updateDirection,
    fileStatus,
    translationKey,
    doTranslate,
    doTranslateStream,
    doTranslateFile,
    handleStreamChunk,
    handleStreamDone,
  };
}
