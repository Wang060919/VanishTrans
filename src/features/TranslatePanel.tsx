import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, ClipboardPaste, Copy, Eraser, FileText, RefreshCw, Sparkles, Square } from "lucide-react";
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
  error?: string | null;
  loading: boolean;
  glowActive: boolean;
  onClearGlow: () => void;
  onTranslate: (forceRefresh?: boolean) => void;
  onCancel?: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  streaming?: boolean;
  fileStatus: string | null;
  onTranslateFile: (filename: string, content: string) => void;
  translationKey: number;
}

export default function TranslatePanel({
  inputText, onInputChange,
  outputText, error = null, loading, glowActive, onClearGlow,
  onTranslate, onCancel, inputRef,
  streaming = false,
  fileStatus, onTranslateFile,
  translationKey,
}: TranslatePanelProps) {
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ignoreCache, setIgnoreCache] = useState(false);
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
    const isLegacyError = outputText.startsWith("❌");
    if (!outputText || isLegacyError) return;
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
    if (loading) return;
    event.preventDefault();
    event.stopPropagation();
    dragOverCounter.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragging(true);
  }, [loading]);

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
    if (loading) return;
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onTranslateFile(file.name, reader.result as string);
    reader.onerror = () => window.alert("读取文件失败，请检查文件是否可访问。");
    reader.readAsText(file);
  }, [loading, onTranslateFile]);

  const isLegacyError = outputText.startsWith("❌");
  const displayError = error ?? (isLegacyError ? outputText.replace(/^❌\s*/, "") : null);
  const copyableText = isLegacyError ? "" : outputText;
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

      <div className="acrylic-panel">
        <section className="translation-section translation-section--source" aria-labelledby="source-title">
          <div className="section-toolbar">
            <div className="section-heading">
              <span id="source-title">原文</span>
              {inputText && <span className="section-meta">{inputText.length.toLocaleString()} 字</span>}
            </div>
            <div className="section-actions">
              {inputText && (
                <button type="button" className="text-action" disabled={loading} onClick={() => onInputChange("")} aria-label="清除原文">
                  <Eraser size={14} aria-hidden="true" />清除
                </button>
              )}
              <button type="button" className="text-action" disabled={loading} onClick={handlePaste} aria-label="粘贴文本">
                <ClipboardPaste size={14} aria-hidden="true" />粘贴
              </button>
            </div>
          </div>
          <div className="editor-frame">
            <textarea
              ref={inputRef}
              value={inputText}
              disabled={loading}
              maxLength={MAX_INPUT_CHARS}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder="输入、粘贴或拖入文件"
              spellCheck={false}
              onKeyDown={(event) => {
                if (!loading && event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onTranslate(ignoreCache);
                }
              }}
            />
            <div className="editor-footer">
              <CharCounter current={inputText.length} max={MAX_INPUT_CHARS} compact />
              <div className="editor-footer-actions">
                <button
                  type="button"
                  className={`ignore-cache-toggle ${ignoreCache ? "ignore-cache-toggle--active" : ""}`}
                  aria-pressed={ignoreCache}
                  title="忽略翻译记忆缓存，强制请求 API"
                  disabled={loading}
                  onClick={() => setIgnoreCache((current) => !current)}
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  <span>忽略缓存</span>
                </button>
                <button type="button" className="translate-action" aria-label="翻译文本" disabled={!inputText.trim() || loading} onClick={() => onTranslate(ignoreCache)}>
                  <Sparkles size={14} aria-hidden="true" />
                  <span>{loading ? "翻译中" : "Enter 翻译"}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className={`signal-divider ${loading ? "signal-divider--active" : ""} ${glowActive ? "signal-divider--complete" : ""}`} aria-hidden="true">
          <span /><i />
        </div>

        <section className="translation-section translation-section--result group" aria-labelledby="result-title">
          <div className="section-toolbar">
            <div className="section-heading">
              <span id="result-title">译文</span>
              {isStreamingActive && <span className="section-meta section-meta--active">流式生成中</span>}
              {!loading && outputText && !isLegacyError && !displayError && <span className="section-meta section-meta--success">已完成</span>}
            </div>
            <div className="section-actions section-actions--result">
              {loading && (
                <button type="button" className="text-action text-action--danger" onClick={onCancel} aria-label="取消翻译">
                  <Square size={12} aria-hidden="true" />取消
                </button>
              )}
              <SignalBurst active={copied}>
                <button type="button" className="text-action" disabled={!copyableText} onClick={handleCopyOutput} aria-label="复制译文">
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </SignalBurst>
              {displayError && !loading && (
                <button type="button" className="text-action text-action--danger" onClick={() => onTranslate(ignoreCache)} aria-label="重试翻译">
                  <RefreshCw size={14} aria-hidden="true" />重试
                </button>
              )}
            </div>
          </div>
          <div className="result-frame" aria-live="polite">
            {displayError && <p className="result-notice" role="alert">{displayError}</p>}
            {loading && !outputText && !displayError ? (
              <LoadingState />
            ) : outputText ? (
              !isLegacyError && <AnimatedContent key={translationKey} preset="slide-up"><p className="translation-copy">{outputText}</p></AnimatedContent>
            ) : displayError ? null : (
              <div className="empty-translation">
                <VanishMark compact animated={false} decorative />
                <strong>等待一次语言转换</strong>
                <span>输入文本，或使用 Alt+Q 翻译已选内容</span>
              </div>
            )}
          </div>
        </section>
      </div>
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
