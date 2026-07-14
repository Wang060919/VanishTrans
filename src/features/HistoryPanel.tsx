import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import AnimatedList from "../components/AnimatedList";
import ClickSpark from "../components/ClickSpark";
import type { TranslationRecord } from "../types";

interface HistoryPanelProps {
  records: TranslationRecord[];
  search: string;
  onSearch: (q: string) => void;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
  onClear: () => void;
}

export default function HistoryPanel({ records, search, onSearch, onCopy, onDelete, onClear }: HistoryPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 border-b border-border bg-surface-raised shadow-card">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索历史..."
          className="flex-1 text-[12px] border border-border-subtle rounded-lg px-3 py-1.5 bg-[#f8f8f8] dark:bg-surface-overlay focus:outline-none focus:ring-2 focus:ring-primary-soft placeholder:text-text-ghost transition-all"
        />
        <button
          onClick={onClear}
          className="text-[11px] font-medium text-text-ghost hover:text-danger px-2 py-1 rounded-lg hover:bg-danger-soft transition-all"
          title="清空历史"
        >
          清空
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {records.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[12px] text-text-ghost select-none">
            暂无翻译历史
          </div>
        ) : (
          <AnimatedList>
            {records.map((r) => (
              <div
                key={r.id}
                className="group px-3 py-2 border-b border-border hover:bg-surface-raised transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-text-muted truncate">{r.original}</p>
                    <p className="text-[12px] text-text mt-0.5">{r.translated}</p>
                    <span className="text-[10px] text-text-ghost mt-0.5 inline-block">
                      {r.direction} · {new Date(r.timestamp * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ClickSpark color="var(--color-primary)" count={6}>
                      <button
                        onClick={() => onCopy(r.translated)}
                        className="w-6 h-6 flex items-center justify-center rounded text-[10px] hover:bg-black/5 dark:hover:bg-white/5"
                        title="复制译文"
                      >
                        📋
                      </button>
                    </ClickSpark>
                    <button
                      onClick={() => onDelete(r.id)}
                      className="w-6 h-6 flex items-center justify-center rounded text-[10px] hover:bg-danger-soft text-text-disabled hover:text-danger"
                      title="删除"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </AnimatedList>
        )}
      </div>
    </div>
  );
}
