import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import IconButton from "../components/IconButton";
import { LangDirection } from "../hooks/useTranslation";
import type { GlossaryEntry, HotkeyEntry } from "../hooks/useConfig";
import HistoryPanel from "../features/HistoryPanel";
import SettingsPanel from "../features/SettingsPanel";
import TranslatePanel from "../features/TranslatePanel";
import type { TranslationRecord } from "../types";

interface MainLayoutProps {
  inputText: string;
  onInputChange: (v: string) => void;
  outputText: string;
  loading: boolean;
  pinned: boolean;
  onPin: () => void;
  direction: LangDirection;
  onDirectionChange: (d: LangDirection) => void;
  glowActive: boolean;
  onClearGlow: () => void;
  onTranslate: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  hasStoredApiKey: boolean;
  apiKeyUpdate: string | null;
  onApiKeyChange: (v: string | null) => void;
  onSaveConfig: (forcedApiKey?: string) => void;
  glossary: GlossaryEntry[];
  onGlossaryChange: (entries: GlossaryEntry[]) => void;
  hotkeys: HotkeyEntry[];
  hotkeyLabels: Record<string, string>;
  onHotkeysChange: (entries: HotkeyEntry[]) => void;
  streaming: boolean;
}

export default function MainLayout({
  inputText, onInputChange,
  outputText, loading,
  pinned, onPin,
  direction, onDirectionChange,
  glowActive, onClearGlow,
  onTranslate, inputRef,
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyUpdate, onApiKeyChange, onSaveConfig,
  glossary, onGlossaryChange,
  hotkeys, hotkeyLabels, onHotkeysChange,
  streaming,
}: MainLayoutProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<TranslationRecord[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadHistory = useCallback(async (query?: string) => {
    const records = await invoke<any[]>("get_history", { query: query || null });
    setHistoryRecords(records);
  }, []);

  const handleToggleHistory = useCallback(async () => {
    if (!showHistory) {
      await loadHistory();
      setShowHistory(true);
    } else {
      setShowHistory(false);
    }
  }, [showHistory, loadHistory]);

  const handleHistorySearch = useCallback((q: string) => {
    setHistorySearch(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadHistory(q || undefined);
    }, 200);
  }, [loadHistory]);

  const handleCopyHistoryItem = useCallback(async (text: string) => {
    await invoke("write_clipboard_safe", { text });
  }, []);

  const handleDeleteHistoryItem = useCallback(async (id: number) => {
    await invoke("delete_history_record", { id });
    await loadHistory(historySearch || undefined);
  }, [historySearch, loadHistory]);

  const handleClearHistory = useCallback(async () => {
    await invoke("clear_history");
    await loadHistory();
  }, [loadHistory]);

  return (
    <div className="flex flex-col h-screen bg-surface text-text shadow-xl">
      {/* Header */}
      <header
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-raised shrink-0"
      >
        <span
          className="text-[14px] font-bold tracking-tight select-none"
          style={{
            background: "linear-gradient(90deg, var(--color-primary) 0%, #60a5fa 40%, var(--color-primary) 80%)",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            animation: "shiny 3s ease-in-out infinite",
            willChange: "background-position",
          }}
        >
          VanishTrans
        </span>
        <div className="flex items-center gap-1.5">
          <select
            value={direction}
            onChange={(e) => onDirectionChange(e.target.value as LangDirection)}
            className="text-[11px] font-medium border border-border-strong rounded-md px-2 py-1 bg-[#f5f5f5] dark:bg-surface-overlay cursor-pointer text-text-secondary focus:ring-2 focus:ring-primary-soft transition-all"
          >
            <option value="auto">自动</option>
            <option value="auto2zh">自动 → 中文</option>
            <option value="auto2en">自动 → 英文</option>
            <option value="zh2en">中文 → 英文</option>
            <option value="en2zh">英文 → 中文</option>
          </select>
          <IconButton icon="⚙" active={showSettings} onClick={() => setShowSettings(!showSettings)} title="API 设置" />
          <IconButton icon="📋" active={showHistory} onClick={handleToggleHistory} title="翻译历史" />
          <IconButton icon="📌" active={pinned} onClick={onPin} title={pinned ? "取消置顶" : "固定置顶"} />
        </div>
      </header>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          baseUrl={baseUrl} onBaseUrlChange={onBaseUrlChange}
          model={model} onModelChange={onModelChange}
          hasStoredApiKey={hasStoredApiKey}
          apiKeyUpdate={apiKeyUpdate} onApiKeyChange={onApiKeyChange}
          onSave={onSaveConfig}
          glossary={glossary} onGlossaryChange={onGlossaryChange}
          hotkeys={hotkeys} hotkeyLabels={hotkeyLabels} onHotkeysChange={onHotkeysChange}
        />
      )}

      {/* History panel */}
      {showHistory && (
        <HistoryPanel
          records={historyRecords}
          search={historySearch}
          onSearch={handleHistorySearch}
          onCopy={handleCopyHistoryItem}
          onDelete={handleDeleteHistoryItem}
          onClear={handleClearHistory}
        />
      )}

      {/* Translate panel */}
      <TranslatePanel
        inputText={inputText} onInputChange={onInputChange}
        outputText={outputText} loading={loading}
        glowActive={glowActive} onClearGlow={onClearGlow}
        onTranslate={onTranslate}
        inputRef={inputRef}
        streaming={streaming}
      />

      {/* Footer */}
      <footer className="px-4 py-2 border-t border-border bg-surface-raised text-[11px] flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-3 text-text-ghost">
          <KbdHint keys="Alt+Q" label="弹窗" />
          <KbdHint keys="Alt+W" label="截图" />
          <KbdHint keys="Alt+R" label="替换" />
        </div>
        <span className={`flex items-center gap-1 ${pinned ? "text-primary font-medium" : ""}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${pinned ? "bg-primary" : "bg-text-disabled"}`} />
          {pinned ? "已置顶" : "自动隐藏"}
        </span>
      </footer>
    </div>
  );
}

function KbdHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="px-1 py-0.5 text-[9px] font-mono bg-[#f0f0f0] dark:bg-surface-overlay rounded border border-border-strong">
        {keys}
      </kbd>{" "}
      {label}
    </span>
  );
}
