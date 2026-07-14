import { Check, Copy, History, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import SignalBurst from "../components/SignalBurst";
import type { TranslationRecord } from "../types";

interface HistoryPanelProps {
  records: TranslationRecord[];
  search: string;
  onSearch: (q: string) => void;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
  onClear: () => void;
}

function groupLabel(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((today - day) / 86_400_000);
  if (difference === 0) return "今天";
  if (difference === 1) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

export default function HistoryPanel({ records, search, onSearch, onCopy, onDelete, onClear }: HistoryPanelProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const groups = useMemo(() => {
    const grouped = new Map<string, TranslationRecord[]>();
    records.forEach((record) => {
      const label = groupLabel(record.timestamp);
      grouped.set(label, [...(grouped.get(label) ?? []), record]);
    });
    return Array.from(grouped.entries());
  }, [records]);

  const copyRecord = (record: TranslationRecord) => {
    onCopy(record.translated);
    setCopiedId(record.id);
    setTimeout(() => setCopiedId((current) => current === record.id ? null : current), 1000);
  };

  return (
    <div className="history-panel">
      <div className="history-tools">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">搜索翻译历史</span>
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索原文或译文" />
        </label>
        {records.length > 0 && (
          <button type="button" className="danger-link" onClick={() => { if (window.confirm("确定清空全部翻译历史？")) onClear(); }}>
            清空
          </button>
        )}
      </div>

      <div className="history-scroll">
        {records.length === 0 ? (
          <div className="panel-empty">
            <History size={24} aria-hidden="true" />
            <strong>{search ? "没有匹配的翻译" : "还没有翻译历史"}</strong>
            <span>{search ? "尝试其他关键词" : "完成翻译后，记录会出现在这里"}</span>
          </div>
        ) : groups.map(([label, items]) => (
          <section className="history-group" key={label} aria-labelledby={`history-${label}`}>
            <h3 id={`history-${label}`}>{label}</h3>
            <div className="history-list">
              {items.map((record, index) => (
                <article className="history-item" key={record.id} style={{ "--item-index": Math.min(index, 7) } as React.CSSProperties}>
                  <div className="history-copy">
                    <p className="history-original">{record.original}</p>
                    <p className="history-translated">{record.translated}</p>
                    <span>{record.direction} · {new Date(record.timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="history-actions">
                    <SignalBurst active={copiedId === record.id}>
                      <button type="button" aria-label="复制译文" onClick={() => copyRecord(record)}>
                        {copiedId === record.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </SignalBurst>
                    <button type="button" aria-label="删除记录" className="history-delete" onClick={() => onDelete(record.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
