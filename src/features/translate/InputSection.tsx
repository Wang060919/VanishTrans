import { ClipboardPaste, Eraser, RefreshCw, Sparkles } from "lucide-react";
import { useCallback } from "react";
import { readClipboardSafe } from "../../services/tauriBridge";
import CharCounter from "../../components/CharCounter";
import { countChars, formatNumber, truncateText } from "../../lib/textUtils";

const MAX_INPUT_CHARS = 10_000;

interface InputSectionProps {
  inputText: string;
  onInputChange: (text: string) => void;
  onTranslate: (forceRefresh: boolean) => void;
  loading: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  ignoreCache: boolean;
  onToggleIgnoreCache: () => void;
}

/**
 * InputSection - Source text input area with toolbar.
 * Single responsibility: render and manage source text input.
 */
export default function InputSection({
  inputText,
  onInputChange,
  onTranslate,
  loading,
  inputRef,
  ignoreCache,
  onToggleIgnoreCache,
}: InputSectionProps) {
  const handlePaste = useCallback(async () => {
    try {
      const text = await readClipboardSafe();
      if (text) onInputChange(truncateText(text, MAX_INPUT_CHARS));
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  }, [inputRef, onInputChange]);

  return (
    <section
      className="translation-section translation-section--source"
      aria-labelledby="source-title"
    >
      <div className="section-toolbar">
        <div className="section-heading">
          <span id="source-title">原文</span>
          {inputText && (
            <span className="section-meta">{formatNumber(countChars(inputText))} 字</span>
          )}
        </div>
        <div className="section-actions">
          {inputText && (
            <button
              type="button"
              className="text-action"
              disabled={loading}
              onClick={() => onInputChange("")}
              aria-label="清除原文"
            >
              <Eraser size={14} aria-hidden="true" />
              清除
            </button>
          )}
          <button
            type="button"
            className="text-action"
            disabled={loading}
            onClick={handlePaste}
            aria-label="粘贴文本"
          >
            <ClipboardPaste size={14} aria-hidden="true" />
            粘贴
          </button>
        </div>
      </div>

      <div className="editor-frame">
        <textarea
          ref={inputRef}
          value={inputText}
          disabled={loading}
          onChange={(event) => onInputChange(truncateText(event.target.value, MAX_INPUT_CHARS))}
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
          <CharCounter current={countChars(inputText)} max={MAX_INPUT_CHARS} compact />
          <div className="editor-footer-actions">
            <button
              type="button"
              className={`ignore-cache-toggle ${
                ignoreCache ? "ignore-cache-toggle--active" : ""
              }`}
              aria-pressed={ignoreCache}
              title="忽略翻译记忆缓存，强制请求 API"
              disabled={loading}
              onClick={onToggleIgnoreCache}
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span>忽略缓存</span>
            </button>
            <button
              type="button"
              className="translate-action"
              aria-label="翻译文本"
              disabled={!inputText.trim() || loading}
              onClick={() => onTranslate(ignoreCache)}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>{loading ? "翻译中" : "Enter 翻译"}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
