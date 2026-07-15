import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

interface TmEntry {
  id: number;
  source: string;
  target: string;
  source_lang: string;
  target_lang: string;
  created_at: number;
  hit_count: number;
}

interface TmStats {
  total_entries: number;
  total_hits: number;
}

interface TmPanelProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export default function TmPanel({ searchQuery, onSearchChange }: TmPanelProps) {
  const [entries, setEntries] = useState<TmEntry[]>([]);
  const [stats, setStats] = useState<TmStats>({ total_entries: 0, total_hits: 0 });

  const loadEntries = useCallback(async (query?: string) => {
    const result = await invoke<TmEntry[]>("tm_search", { query: query || null });
    setEntries(result ?? []);
  }, []);

  const loadStats = useCallback(async () => {
    const s = await invoke<TmStats>("tm_stats");
    setStats(s ?? { total_entries: 0, total_hits: 0 });
  }, []);

  useEffect(() => {
    loadEntries(searchQuery || undefined);
    loadStats();
  }, [searchQuery, loadEntries, loadStats]);

  const handleDelete = useCallback(async (id: number) => {
    await invoke("tm_delete", { id });
    await loadEntries(searchQuery || undefined);
    await loadStats();
  }, [searchQuery, loadEntries, loadStats]);

  const handleClear = useCallback(async () => {
    if (!window.confirm("确定清空所有翻译记忆？")) return;
    await invoke("tm_clear");
    await loadEntries();
    await loadStats();
  }, [loadEntries, loadStats]);

  const handleExport = useCallback(async () => {
    try {
      const path = await invoke<string>("plugin:dialog|save", {
        defaultPath: "translation_memory.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path) {
        const count = await invoke<number>("tm_export", { path });
        window.alert(`已导出 ${count} 条翻译记忆`);
      }
    } catch (_) {}
  }, []);

  return (
    <div className="history-panel">
      {/* Stats bar */}
      <div className="history-tools">
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--color-ink-muted)" }}>
          <span>条目 <b style={{ color: "var(--color-ink)" }}>{stats.total_entries}</b></span>
          <span>命中 <b style={{ color: "var(--color-signal)" }}>{stats.total_hits}</b> 次</span>
        </div>
      </div>

      {/* Search */}
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
                    {entry.source_lang}→{entry.target_lang} · 命中 {entry.hit_count} 次
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
