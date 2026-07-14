import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useRef, useState } from "react";
import CharCounter from "../components/CharCounter";
import ClickSpark from "../components/ClickSpark";
import GlowBorder from "../components/GlowBorder";
import Typewriter from "../components/Typewriter";
import { MAX_FILE_SIZE } from "../lib/fileParser";

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
}

export default function TranslatePanel({
  inputText, onInputChange,
  outputText, loading, glowActive, onClearGlow,
  onTranslate, inputRef,
  streaming = false,
  fileStatus, onTranslateFile,
}: TranslatePanelProps) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleCopyOutput = useCallback(async () => {
    if (!outputText || outputText.startsWith("❌")) return;
    await invoke("write_clipboard_safe", { text: outputText });
  }, [outputText]);

  // ── Drag & Drop ────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Size check
    if (file.size > MAX_FILE_SIZE) {
      const sizeKB = Math.round(file.size / 1024);
      if (!window.confirm(`文件较大 (${sizeKB} KB)，翻译可能较慢。继续？`)) {
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      onTranslateFile(file.name, content);
    };
    reader.readAsText(file);
  }, [onTranslateFile]);

  // ── Render helpers ─────────────────────────────────────

  const isError = outputText.startsWith("❌");
  const isStreamingActive = loading && streaming;
  const isComplete = !loading && !isError && outputText.length > 0;

  return (
    <div
      className="flex-1 flex flex-col p-3 gap-2.5 min-h-0 overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary-soft/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <span className="text-3xl">📁</span>
            <span className="text-[13px] font-medium text-primary">释放文件以翻译</span>
            <span className="text-[10px] text-text-muted">支持 .txt / .srt / .json</span>
          </div>
        </div>
      )}

      {/* File status toast */}
      {fileStatus && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-surface-raised border border-border rounded-lg px-3 py-1.5 shadow-float text-[11px] text-text-secondary animate-fade-in">
          {fileStatus}
        </div>
      )}

      {/* Input area */}
      <div className="relative flex-1 min-h-0">
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="选中文本按 Alt+Q 翻译 · Alt+W 截图OCR · 粘贴后 Enter 翻译 · 拖拽 .txt/.srt/.json 文件"
          className="w-full h-full resize-none border border-border-subtle dark:border-border rounded-xl p-3.5 pb-8 text-[13px] leading-relaxed focus:ring-2 focus:ring-primary-soft focus:border-primary-border bg-surface-raised dark:bg-surface-overlay placeholder:text-text-ghost shadow-sm transition-all"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onTranslate();
            }
          }}
        />
        <CharCounter current={inputText.length} max={MAX_INPUT_CHARS} className="absolute bottom-2.5 left-3.5 right-3.5" />
      </div>

      {/* Output area */}
      <GlowBorder active={glowActive} className="flex-1 min-h-0">
        <div
          className="relative h-full border border-border rounded-xl p-3.5 text-[13px] leading-relaxed bg-surface-sunken overflow-y-auto select-text shadow-sm transition-all"
          role="status"
          aria-live="polite"
        >
          {loading && !streaming && !outputText ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <LoadingDots />
              <span className="text-[11px] text-text-muted select-none font-medium">翻译中...</span>
            </div>
          ) : isStreamingActive ? (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <LoadingDots />
                <span className="text-[10px] text-text-muted select-none">流式传输中...</span>
              </div>
              <p className="whitespace-pre-wrap text-text">{outputText}</p>
            </>
          ) : outputText ? (
            <>
              <p className="whitespace-pre-wrap text-text">
                {isError ? outputText : (
                  <Typewriter key={`done-${outputText.length}`} text={outputText} speed={20} />
                )}
              </p>
              {!isError ? (
                <ClickSpark color="var(--color-primary)" count={8} className="absolute top-2.5 right-2.5">
                  <button
                    onClick={handleCopyOutput}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-[12px] text-text-muted hover:bg-surface-raised/80 dark:hover:bg-surface-overlay hover:text-primary transition-all shadow-sm"
                    title="复制翻译结果"
                  >
                    📋
                  </button>
                </ClickSpark>
              ) : (
                <button
                  onClick={onTranslate}
                  className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center rounded-lg text-[12px] text-text-muted hover:bg-danger-soft hover:text-danger transition-all shadow-sm"
                  title="重试翻译"
                >
                  🔄
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="text-3xl select-none animate-breathe">🌐</div>
              <p className="text-[12px] text-text-ghost select-none text-center leading-relaxed">
                翻译结果将显示在此处
              </p>
              <p className="text-[10px] text-text-disabled select-none">
                Alt+Q 划词 · Alt+W 截图OCR · Alt+R 替换 · 拖拽文件翻译
              </p>
            </div>
          )}
        </div>
      </GlowBorder>
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-primary animate-[pulseDot_1.4s_ease-in-out_infinite]" />
      <span className="w-2 h-2 rounded-full bg-primary animate-[pulseDot_1.4s_ease-in-out_0.2s_infinite]" />
      <span className="w-2 h-2 rounded-full bg-primary animate-[pulseDot_1.4s_ease-in-out_0.4s_infinite]" />
    </div>
  );
}
