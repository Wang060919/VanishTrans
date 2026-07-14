import { invoke } from "@tauri-apps/api/core";
import React, { useCallback } from "react";
import CharCounter from "../components/CharCounter";
import ClickSpark from "../components/ClickSpark";
import GlowBorder from "../components/GlowBorder";
import Typewriter from "../components/Typewriter";

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
}

export default function TranslatePanel({
  inputText, onInputChange,
  outputText, loading, glowActive, onClearGlow,
  onTranslate, inputRef,
  streaming = false,
}: TranslatePanelProps) {
  const handleCopyOutput = useCallback(async () => {
    if (!outputText || outputText.startsWith("❌")) return;
    await invoke("write_clipboard_safe", { text: outputText });
  }, [outputText]);

  const isError = outputText.startsWith("❌");
  const isStreamingActive = loading && streaming;
  const isComplete = !loading && !isError && outputText.length > 0;

  return (
    <div className="flex-1 flex flex-col p-3 gap-2.5 min-h-0 overflow-hidden">
      {/* Input area */}
      <div className="relative flex-1 min-h-0">
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="选中文本按 Alt+Q 翻译 · Alt+W 截图OCR · 粘贴后 Enter 翻译"
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
            /* Non-streaming loading: just dots */
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <LoadingDots />
              <span className="text-[11px] text-text-muted select-none font-medium">翻译中...</span>
            </div>
          ) : isStreamingActive ? (
            /* Streaming in progress: dots + growing text */
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <LoadingDots />
                <span className="text-[10px] text-text-muted select-none">流式传输中...</span>
              </div>
              <p className="whitespace-pre-wrap text-text">{outputText}</p>
            </>
          ) : outputText ? (
            /* Translation complete or error */
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
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="text-3xl select-none animate-breathe">🌐</div>
              <p className="text-[12px] text-text-ghost select-none text-center leading-relaxed">
                翻译结果将显示在此处
              </p>
              <p className="text-[10px] text-text-disabled select-none">
                Alt+Q 划词 · Alt+W 截图OCR · Alt+R 替换
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
