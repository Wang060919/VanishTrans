import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";

export interface TranslateState {
  inputText: string;
  outputText: string;
  loading: boolean;
  glowActive: boolean;
  streaming: boolean;
}

export type LangDirection = "auto" | "auto2zh" | "auto2en" | "zh2en" | "en2zh";

export function useTranslation() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [glowActive, setGlowActive] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [direction, setDirection] = useState<LangDirection>("auto2zh");

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

  return {
    inputText, setInputText,
    outputText, setOutputText,
    loading, setLoading,
    glowActive, clearGlow,
    streaming,
    direction, updateDirection,
    doTranslate,
    doTranslateStream,
    handleStreamChunk,
    handleStreamDone,
  };
}
