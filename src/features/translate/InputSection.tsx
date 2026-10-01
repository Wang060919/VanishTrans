import { ClipboardPaste, Eraser, RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { readClipboardSafe } from "../../services/tauriBridge";
import CharCounter from "../../components/CharCounter";
import { countChars, formatNumber, truncateText } from "../../lib/textUtils";

const MAX_INPUT_CHARS = 10_000;

interface InputSectionProps {
  inputText: string;
  /** True while anything exists to clear (input, output, error, file status). */
  canClear: boolean;
  onInputChange: (text: string) => void;
  /** Clears the whole session (input + output + error), not just the textarea. */
  onClear: () => void;
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
  canClear,
  onInputChange,
  onClear,
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
          {canClear && (
            <button
              type="button"
              className="text-action"
              disabled={loading}
              onClick={() => { onClear(); inputRef.current?.focus(); }}
              aria-label="清空输入与译文"
              title="清空输入与译文"
            >
              <Eraser size={14} aria-hidden="true" />
              清空
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
          aria-label="原文"
          value={inputText}
          disabled={loading}
          onChange={(event) => onInputChange(truncateText(event.target.value, MAX_INPUT_CHARS))}
          placeholder="输入、粘贴或拖入文件"
          spellCheck={false}
          onKeyDown={(event) => {
            if (!loading && !event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
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

          </div>
        </div>
      </div>
    </section>
  );
}
