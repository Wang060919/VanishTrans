import type { MouseEventHandler, RefObject } from "react";
import { ArrowUpRight, Check, Copy, Expand, RefreshCw, X } from "lucide-react";
import VanishMark from "../components/brand/VanishMark";

interface Props {
  embedded?: boolean;
  directionLabel?: string;
  shellRef?: RefObject<HTMLDivElement>;
  source: string;
  output: string;
  error?: string | null;
  loading: boolean;
  copied: boolean;
  onDrag?: MouseEventHandler<HTMLElement>;
  onCopy: () => void;
  onExpand: () => void;
  onClose: () => void;
  onRetry: () => void;
}

/** Shared visual surface for the native quick window and browser preview. */
export default function QuickTranslationView({
  shellRef, source, output, error, loading, copied, embedded = false, directionLabel,
  onDrag, onCopy, onExpand, onClose, onRetry,
}: Props) {
  const compactResult = Boolean(output) && !loading && !error;
  const status = copied ? "已复制" : error ? "未完成" : loading ? "翻译中" : output ? "译文" : "即时翻译";

  // Embedded in the island, the header doubles as an expand affordance:
  // press-and-move drags the card (window-level pointer handlers), a plain
  // click expands it — the same contract as the island core.
  const handleHeaderClick: MouseEventHandler<HTMLElement> | undefined = embedded
    ? (event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        onExpand();
      }
    : undefined;

  return (
    <section ref={shellRef} className={"quick-translate-shell" + (compactResult ? " quick-translate-shell--result" : "")} data-state={error ? "error" : loading ? "working" : output ? "done" : "idle"} aria-label="即时翻译">
      <header className="quick-translate-header" onMouseDown={onDrag} onClick={handleHeaderClick} data-tauri-drag-region={embedded ? undefined : true}>
        <div className="quick-translate-brand">
          <VanishMark compact animated={false} decorative />
          <span className={loading ? "quick-translate-status quick-translate-status--active" : "quick-translate-status"}>
            {compactResult && directionLabel && !copied ? directionLabel : status}
          </span>
        </div>
        <div className="quick-translate-actions">
          {!compactResult && <button type="button" onClick={onCopy} disabled={!output} aria-label={copied ? "译文已复制" : "复制译文"} title={copied ? "已复制" : "复制"}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>}
          {!compactResult && <button type="button" onClick={onExpand} disabled={!source} aria-label="在主窗口中打开" title="展开">
            <Expand size={14} />
          </button>}
          <button type="button" onClick={onClose} aria-label="关闭迷你翻译" title="关闭">
            <X size={15} />
          </button>
        </div>
      </header>

      {source && (!compactResult || !embedded) && (
        <div className="quick-source selectable" title={source}>
          {source}
        </div>
      )}

      <div className="quick-result" role="status" aria-live="polite">
        {error ? (
          <div className="quick-error">
            <span>{error}</span>
            {source && !compactResult && (
              <button type="button" onClick={onRetry} aria-label="重试翻译" title="重试">
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        ) : output ? (
          <p className={loading ? "quick-result-text selectable quick-result-text--streaming" : "quick-result-text selectable"}>
            {output}
          </p>
        ) : (
          loading ? <div className="quick-loading" aria-label="正在翻译"><i /><i /><i /></div> : <p className="quick-empty">选中文字，即可开始翻译</p>
        )}
      </div>
      {compactResult && <footer className="island-result-footer">
        <button type="button" className="island-result-copy" onClick={onCopy}
          aria-label={copied ? "译文已复制" : "复制译文"}>
          {copied ? <Check size={16} /> : <Copy size={16} />}<span>{copied ? "已复制" : "复制译文"}</span>
        </button>
        <button type="button" className="island-result-expand" onClick={onExpand}
          aria-label="在主窗口中打开" title="查看原文、编辑或翻译更多内容">
          <span>查看详情</span><ArrowUpRight size={16} />
        </button>
      </footer>}
    </section>
  );
}
