import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, ClipboardPaste, Copy, Eraser, FileText, RefreshCw, Sparkles } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import AnimatedContent from "../components/AnimatedContent";
import CharCounter from "../components/CharCounter";
import SignalBurst from "../components/SignalBurst";
import VanishMark from "../components/brand/VanishMark";
const MAX_INPUT_CHARS = 10_000;

interface TranslatePanelProps {
  inputText: string;
  onInputChange: (v: string) => void;
  outputText: string;
  loading: boolean;
  glowActive: boolean;
  onClearGlow: () => void;
  onTranslate: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  streaming?: boolean;
  fileStatus: string | null;
  onTranslateFile: (filename: string, content: string) => void;
  translationKey: number;
}

export default function TranslatePanel({
  inputText, onInputChange,
  outputText, loading, glowActive, onClearGlow,
  onTranslate, inputRef,
  streaming = false,
  fileStatus, onTranslateFile,
  translationKey,
}: TranslatePanelProps) {
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const dragOverCounter = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (!glowActive) return;
    const timer = setTimeout(onClearGlow, 900);
    return () => clearTimeout(timer);
  }, [glowActive, onClearGlow]);

  const handleCopyOutput = useCallback(async () => {
    if (!outputText || outputText.startsWith("❌")) return;
    await invoke("write_clipboard_safe", { text: outputText });
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [outputText]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await readText();
      if (text) onInputChange(text);
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  }, [inputRef, onInputChange]);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverCounter.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverCounter.current -= 1;
    if (dragOverCounter.current <= 0) {
      dragOverCounter.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverCounter.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onTranslateFile(file.name, reader.result as string);
    reader.onerror = () => window.alert("读取文件失败，请检查文件是否可访问。");
    reader.readAsText(file);
  }, [onTranslateFile]);

  const isError = outputText.startsWith("❌");
  const isStreamingActive = loading && streaming;

  return (
    <main
      className="translation-workspace"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="file-drop-overlay" role="status">
          <FileText size={28} aria-hidden="true" />
          <strong>释放文件以翻译</strong>
          <span>支持 TXT、SRT 和 JSON</span>
        </div>
      )}

      {fileStatus && <div className="file-status" role="status">{fileStatus}</div>}

      <section className="translation-section translation-section--source" aria-labelledby="source-title">
        <div className="section-toolbar">
          <div className="section-heading">
            <span id="source-title">原文</span>
            {inputText && <span className="section-meta">{inputText.length.toLocaleString()} 字</span>}
          </div>
          <div className="section-actions">
            {inputText && (
              <button type="button" className="text-action" onClick={() => onInputChange("")} aria-label="清除原文">
                <Eraser size={14} aria-hidden="true" />清除
              </button>
            )}
            <button type="button" className="text-action" onClick={handlePaste} aria-label="粘贴文本">
              <ClipboardPaste size={14} aria-hidden="true" />粘贴
            </button>
          </div>
        </div>
        <div className="editor-frame">
          <textarea
            ref={inputRef}
            value={inputText}
            maxLength={MAX_INPUT_CHARS}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder="输入、粘贴或拖入文件"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onTranslate();
              }
            }}
          />
          <div className="editor-footer">
            <CharCounter current={inputText.length} max={MAX_INPUT_CHARS} compact />
            <button type="button" className="translate-action" aria-label="翻译文本" disabled={!inputText.trim() || loading} onClick={onTranslate}>
              <Sparkles size={14} aria-hidden="true" />
              <span>{loading ? "翻译中" : "Enter 翻译"}</span>
            </button>
          </div>
        </div>
      </section>

      <div className={`signal-divider ${loading ? "signal-divider--active" : ""} ${glowActive ? "signal-divider--complete" : ""}`} aria-hidden="true">
        <span /><i />
      </div>

      <section className="translation-section translation-section--result" aria-labelledby="result-title">
        <div className="section-toolbar">
          <div className="section-heading">
            <span id="result-title">译文</span>
            {isStreamingActive && <span className="section-meta section-meta--active">流式生成中</span>}
            {!loading && outputText && !isError && <span className="section-meta section-meta--success">已完成</span>}
          </div>
          <div className="section-actions">
            {outputText && !isError && (
              <SignalBurst active={copied}>
                <button type="button" className="text-action" onClick={handleCopyOutput} aria-label="复制译文">
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </SignalBurst>
            )}
            {isError && (
              <button type="button" className="text-action text-action--danger" onClick={onTranslate} aria-label="重试翻译">
                <RefreshCw size={14} aria-hidden="true" />重试
              </button>
            )}
          </div>
        </div>
        <div className="result-frame" role="status" aria-live="polite">
          {loading && !outputText ? (
            <LoadingState />
          ) : outputText ? (
            <AnimatedContent key={translationKey} preset="slide-up"><p className={`translation-copy ${isError ? "translation-copy--error" : ""}`}>{isError ? outputText.replace(/^❌\s*/, "") : outputText}</p></AnimatedContent>
          ) : (
            <div className="empty-translation">
              <VanishMark compact animated={false} decorative />
              <strong>等待一次语言转换</strong>
              <span>输入文本，或使用 Alt+Q 翻译已选内容</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-dots" aria-hidden="true"><i /><i /><i /></div>
      <span>正在建立语言连接</span>
    </div>
  );
}
