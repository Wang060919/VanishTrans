import { Check, Copy, RefreshCw, Square } from "lucide-react";
import { useCallback, useRef, useState, useEffect } from "react";
import { writeClipboardSafe } from "../../services/tauriBridge";
import AnimatedContent from "../../components/AnimatedContent";
import SignalBurst from "../../components/SignalBurst";
import VanishMark from "../../components/brand/VanishMark";
import { isErrorMessage, stripErrorMarker } from "../../lib/textUtils";

interface OutputSectionProps {
  outputText: string;
  error?: string | null;
  loading: boolean;
  streaming: boolean;
  onTranslate: (forceRefresh: boolean) => void;
  onCancel?: () => void;
  ignoreCache: boolean;
  translationKey: number;
}

/**
 * OutputSection - Translation result display area with toolbar.
 * Single responsibility: render translation output and action buttons.
 */
export default function OutputSection({
  outputText,
  error,
  loading,
  streaming,
  onTranslate,
  onCancel,
  ignoreCache,
  translationKey,
}: OutputSectionProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const handleCopyOutput = useCallback(async () => {
    const hasError = isErrorMessage(outputText);
    if (!outputText || hasError) return;

    await writeClipboardSafe({ text: outputText });
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [outputText]);

  const hasError = isErrorMessage(outputText);
  const displayError = error ?? (hasError ? stripErrorMarker(outputText) : null);
  const copyableText = hasError ? "" : outputText;
  const isStreamingActive = loading && streaming;

  return (
    <section
      className="translation-section translation-section--result group"
      aria-labelledby="result-title"
    >
      <div className="section-toolbar">
        <div className="section-heading">
          <span id="result-title">译文</span>
          {isStreamingActive && (
            <span className="section-meta section-meta--active">流式生成中</span>
          )}
          {!loading && outputText && !hasError && !displayError && (
            <span className="section-meta section-meta--success">已完成</span>
          )}
        </div>
        <div className="section-actions section-actions--result">
          {loading && (
            <button
              type="button"
              className="text-action text-action--danger"
              onClick={onCancel}
              aria-label="取消翻译"
            >
              <Square size={12} aria-hidden="true" />
              取消
            </button>
          )}
          <SignalBurst active={copied}>
            <button
              type="button"
              className="text-action"
              disabled={!copyableText}
              onClick={handleCopyOutput}
              aria-label="复制译文"
            >
              {copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {copied ? "已复制" : "复制"}
            </button>
          </SignalBurst>
          {displayError && !loading && (
            <button
              type="button"
              className="text-action text-action--danger"
              onClick={() => onTranslate(ignoreCache)}
              aria-label="重试翻译"
            >
              <RefreshCw size={14} aria-hidden="true" />
              重试
            </button>
          )}
        </div>
      </div>

      <div className="result-frame" aria-live="polite">
        {displayError && <p className="result-notice" role="alert">{displayError}</p>}
        {loading && !outputText && !displayError ? (
          <LoadingState />
        ) : outputText ? (
          !hasError && (
            <AnimatedContent key={translationKey} preset="slide-up">
              <p className="translation-copy">{outputText}</p>
            </AnimatedContent>
          )
        ) : displayError ? null : (
          <EmptyState />
        )}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span>正在建立语言连接</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-translation">
      <VanishMark compact animated={false} decorative />
      <strong>等待一次语言转换</strong>
      <span>输入文本，或使用 Alt+Q 翻译已选内容</span>
    </div>
  );
}
