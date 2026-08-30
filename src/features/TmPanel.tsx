import { appDataDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearTm,
  deleteTmEntry,
  exportTm,
  getTmStats,
  importTmContent,
  searchTm,
} from "../services/tauriBridge";
import type { TmEntry, TmStats } from "../types";
import { errorMessage } from "../lib/errors";
import { logError } from "../lib/logger";

interface TmPanelProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export default function TmPanel({ searchQuery, onSearchChange }: TmPanelProps) {
  const [entries, setEntries] = useState<TmEntry[]>([]);
  const [stats, setStats] = useState<TmStats>({ total_entries: 0, total_hits: 0 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);
  const statsRequestRef = useRef(0);

  const loadEntries = useCallback(async (query?: string) => {
    const request = ++searchRequestRef.current;
    try {
      const result = await searchTm({ query });
      if (request === searchRequestRef.current) setEntries(result ?? []);
    } catch (error: unknown) {
      if (request === searchRequestRef.current) {
        setEntries([]);
        logError("tm", `搜索翻译记忆失败: ${errorMessage(error)}`, error);
      }
    }
  }, []);

  const loadStats = useCallback(async () => {
    const request = ++statsRequestRef.current;
    try {
      const s = await getTmStats();
      if (request === statsRequestRef.current) {
        setStats(s ?? { total_entries: 0, total_hits: 0 });
      }
    } catch (error: unknown) {
      if (request === statsRequestRef.current) {
        logError("tm", `加载翻译记忆统计失败: ${errorMessage(error)}`, error);
      }
    }
  }, []);

  // Debounced search (200ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadEntries(searchQuery || undefined);
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, loadEntries]);

  // Load stats on mount
  useEffect(() => { loadStats(); }, [loadStats]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      await deleteTmEntry({ id });
      await loadEntries(searchQuery || undefined);
      await loadStats();
    } catch (error: unknown) {
      window.alert(`删除失败: ${errorMessage(error)}`);
    }
  }, [searchQuery, loadEntries, loadStats]);

  const handleClear = useCallback(async () => {
    if (!window.confirm("确定清空所有翻译记忆？")) return;
    try {
      await clearTm();
      await loadEntries();
      await loadStats();
    } catch (error: unknown) {
      window.alert(`清空失败: ${errorMessage(error)}`);
    }
  }, [loadEntries, loadStats]);

  const handleExport = useCallback(async () => {
    try {
      const dir = await appDataDir();
      const path = `${dir}/translation_memory.csv`;
      const count = await exportTm({ path });
      window.alert(`已导出 ${count} 条翻译记忆到:\n${path}`);
    } catch (e: unknown) {
      window.alert(`导出失败: ${errorMessage(e)}`);
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv";
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) return;

          // Validate file size (max 10MB)
          const MAX_FILE_SIZE = 10 * 1024 * 1024;
          if (file.size > MAX_FILE_SIZE) {
            window.alert(`文件过大: ${(file.size / 1024 / 1024).toFixed(1)}MB，最大支持 10MB`);
            return;
          }

          const text = await file.text();

          // Basic CSV validation
          if (!text.trim()) {
            window.alert("文件内容为空");
            return;
          }

          const count = await importTmContent({ content: text });
          await loadEntries(searchQuery || undefined);
          await loadStats();
          window.alert(`已导入 ${count} 条翻译记忆`);
        } catch (e: unknown) {
          window.alert(`导入失败: ${errorMessage(e)}`);
        }
      };
      input.click();
    } catch (e: unknown) {
      window.alert(`导入失败: ${errorMessage(e)}`);
    }
  }, [loadEntries, loadStats, searchQuery]);

  return (
    <div className="history-panel">
      {/* Stats bar */}
      <div className="history-tools">
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--color-ink-muted)" }}>
          <span>条目 <b style={{ color: "var(--color-ink)" }}>{stats.total_entries}</b></span>
          <span>命中 <b style={{ color: "var(--color-signal)" }}>{stats.total_hits}</b> 次</span>
        </div>
      </div>

      {/* Search + actions */}
      <div className="history-tools">
        <div className="search-field">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索翻译记忆..."
          />
        </div>
        <button className="text-action" onClick={handleExport} title="导出 CSV">导出</button>
        <button className="text-action" onClick={handleImport} title="导入 CSV">导入</button>
        <button className="text-action text-action--danger" onClick={handleClear} title="清空">清空</button>
      </div>

      {/* List */}
      <div className="history-scroll">
        {entries.length === 0 ? (
          <div className="panel-empty">
            <strong>暂无翻译记忆</strong>
            <span>翻译时会自动保存到记忆库</span>
          </div>
        ) : (
          <div className="history-list">
            {entries.map((entry, i) => (
              <div
                key={entry.id}
                className="history-item"
                style={{ ["--item-index" as string]: i }}
              >
                <div className="history-copy">
                  <p className="history-original">{entry.source}</p>
                  <p className="history-translated">{entry.target}</p>
                  <span>
                    {entry.target_lang === "Chinese" ? "→中" : "→英"} · 命中 {entry.hit_count} 次
                  </span>
                </div>
                <div className="history-actions">
                  <button
                    className="history-delete"
                    onClick={() => handleDelete(entry.id)}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
