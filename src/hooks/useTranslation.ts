import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import {
  detectFileType,
  parseSrt,
  rebuildSrt,
  parseJson,
  rebuildJson,
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

export function useTranslation() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [glowActive, setGlowActive] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [direction, setDirection] = useState<LangDirection>("auto2zh");
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [translationKey, setTranslationKey] = useState(0);

  const directionRef = useRef(direction);
  const requestIdRef = useRef(0);

  // Keep ref in sync
  const updateDirection = useCallback((d: LangDirection) => {
    directionRef.current = d;
    setDirection(d);
  }, []);

  const doTranslate = useCallback(async (text: string) => {
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
      });
      if (reqId === requestIdRef.current) {
        setOutputText(result);
        setTranslationKey(++translationIdCounter);
        if (!result.startsWith("❌")) {
          setGlowActive(true);
        }
      }
    } catch (e: any) {
      if (e === "CANCELLED" || e?.toString?.() === "CANCELLED") {
        if (reqId === requestIdRef.current) setLoading(false);
        return;
      }
      if (reqId === requestIdRef.current) setOutputText(`❌ ${e}`);
    }
    if (reqId === requestIdRef.current) setLoading(false);
  }, []);

  /// Streaming translation — emits chunks via Tauri events.
  const doTranslateStream = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const cleaned = await invoke<string>("cleanup_clipboard_text", { text });
    setInputText(cleaned);
    setOutputText("");
    setLoading(true);
    setStreaming(true);
    const reqId = ++requestIdRef.current;
    try {
      await invoke<string>("translate_stream", {
        text: cleaned,
        direction: directionRef.current,
      });
      // Stream done — finalize
      if (reqId === requestIdRef.current) {
        setStreaming(false);
        setTranslationKey(++translationIdCounter);
        setGlowActive(true);
      }
    } catch (e: any) {
      if (e === "CANCELLED" || e?.toString?.() === "CANCELLED") {
        if (reqId === requestIdRef.current) {
          setLoading(false);
          setStreaming(false);
        }
        return;
      }
      if (reqId === requestIdRef.current) {
        setOutputText(`❌ ${e}`);
        setStreaming(false);
      }
    }
    if (reqId === requestIdRef.current) {
      setLoading(false);
    }
  }, []);

  /// Called by useTauriEvents when a stream chunk arrives.
  const handleStreamChunk = useCallback((chunk: string) => {
    setOutputText((prev) => prev + chunk);
  }, []);

  /// Called by useTauriEvents when stream is complete.
  const handleStreamDone = useCallback((_fullText: string) => {
    setStreaming(false);
  }, []);

  const clearGlow = useCallback(() => setGlowActive(false), []);

  /// Handle file drag-and-drop: parse structured files, translate, reassemble.
  const doTranslateFile = useCallback(async (filename: string, content: string) => {
    const fileType = detectFileType(filename);
    const reqId = ++requestIdRef.current;

    if (fileType === "txt") {
      // Plain text — just load into input
      setInputText(content);
      setFileStatus(null);
      return;
    }

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
            if (translated[i]) map.set(s.path, translated[i]);
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
        setTimeout(() => {
          if (reqId === requestIdRef.current) setFileStatus(null);
        }, 3000);
      } catch (batchErr: any) {
        if (reqId !== requestIdRef.current) return;
        if (batchErr === "SEGMENT_COUNT_MISMATCH") {
          // Model didn't split correctly — show raw result as plain text
          const rawResult = await invoke<string>("translate_with_direction", {
            text: segments.join("\n\n"),
            direction: directionRef.current,
          });
          if (reqId === requestIdRef.current) {
            setOutputText(rawResult);
            setTranslationKey(++translationIdCounter);
            setFileStatus(`${filename} 结构丢失，已显示纯文本结果`);
            setTimeout(() => {
              if (reqId === requestIdRef.current) setFileStatus(null);
            }, 3000);
          }
        } else {
          throw batchErr; // Re-throw for outer catch
        }
      }
    } catch (e: any) {
      if (reqId === requestIdRef.current) {
        setOutputText(`❌ 文件翻译失败: ${e}`);
        setFileStatus(null);
      }
    }
    if (reqId === requestIdRef.current) setLoading(false);
  }, []);

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
