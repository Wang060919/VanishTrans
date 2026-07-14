import { useCallback } from "react";
import HotkeyEditor from "../components/HotkeyEditor";
import SettingInput from "../components/SettingInput";
import type { GlossaryEntry, HotkeyEntry } from "../hooks/useConfig";

interface SettingsPanelProps {
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  hasStoredApiKey: boolean;
  apiKeyUpdate: string | null;
  onApiKeyChange: (v: string | null) => void;
  onSave: (forcedApiKey?: string) => void;
  glossary: GlossaryEntry[];
  onGlossaryChange: (entries: GlossaryEntry[]) => void;
  hotkeys: HotkeyEntry[];
  hotkeyLabels: Record<string, string>;
  onHotkeysChange: (entries: HotkeyEntry[]) => void;
}

export default function SettingsPanel({
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyUpdate, onApiKeyChange, onSave,
  glossary, onGlossaryChange,
  hotkeys, hotkeyLabels, onHotkeysChange,
}: SettingsPanelProps) {
  const handleAddTerm = useCallback(() => {
    onGlossaryChange([...glossary, { source: "", target: "" }]);
  }, [glossary, onGlossaryChange]);

  const handleUpdateTerm = useCallback((index: number, field: "source" | "target", value: string) => {
    const updated = glossary.map((entry, i) =>
      i === index ? { ...entry, [field]: value } : entry
    );
    onGlossaryChange(updated);
  }, [glossary, onGlossaryChange]);

  const handleDeleteTerm = useCallback((index: number) => {
    onGlossaryChange(glossary.filter((_, i) => i !== index));
  }, [glossary, onGlossaryChange]);

  const handleHotkeyChange = useCallback((action: string, shortcut: string) => {
    onHotkeysChange(hotkeys.map((h) =>
      h.action === action ? { ...h, shortcut } : h
    ));
  }, [hotkeys, onHotkeysChange]);

  return (
    <div className="shrink-0 border-b border-border bg-surface-raised px-4 py-3 space-y-2.5 animate-fade-in shadow-card">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">API 设置</p>
      <SettingInput
        label="Base URL"
        value={baseUrl}
        onChange={(e) => onBaseUrlChange(e.target.value)}
        onBlur={() => onSave()}
        placeholder="https://api.openai.com"
      />
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-text-muted">API Key</label>
        <div className="flex gap-1.5">
          <input
            type="password"
            value={apiKeyUpdate ?? ""}
            onChange={(e) => onApiKeyChange(e.target.value)}
            onBlur={() => onSave()}
            placeholder={hasStoredApiKey ? "已配置，输入新 Key 可替换" : "sk-..."}
            className="min-w-0 flex-1 text-[12px] border border-border-subtle rounded-lg px-3 py-1.5 bg-[#f8f8f8] dark:bg-surface-overlay focus:outline-none focus:ring-2 focus:ring-primary-soft focus:border-primary-border placeholder:text-text-ghost transition-all"
          />
          {hasStoredApiKey && apiKeyUpdate === null && (
            <button
              type="button"
              onClick={() => onSave("")}
              className="shrink-0 rounded-lg border border-border-subtle px-3 text-[11px] font-medium text-text-muted hover:text-danger hover:border-danger/30 transition-all"
            >
              清除
            </button>
          )}
        </div>
      </div>
      <SettingInput
        label="Model Name"
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        onBlur={() => onSave()}
        placeholder="gpt-4o-mini / deepseek-chat / gemini-1.5-flash"
      />

      {/* Hotkeys */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-text-muted">快捷键</label>
        <div className="space-y-1.5">
          {hotkeys.map((h) => (
            <HotkeyEditor
              key={h.action}
              label={hotkeyLabels[h.action] || h.action}
              value={h.shortcut}
              onChange={(shortcut) => handleHotkeyChange(h.action, shortcut)}
            />
          ))}
        </div>
      </div>

      {/* Glossary */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-medium text-text-muted">术语表</label>
          <button
            onClick={handleAddTerm}
            className="text-[10px] font-medium text-primary hover:text-primary-hover transition-colors"
          >
            + 添加
          </button>
        </div>
        {glossary.length > 0 && (
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {glossary.map((entry, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={entry.source}
                  onChange={(e) => handleUpdateTerm(i, "source", e.target.value)}
                  onBlur={() => onGlossaryChange(glossary)}
                  placeholder="原文"
                  className="min-w-0 flex-1 text-[11px] border border-border-subtle rounded-md px-2 py-1 bg-[#f8f8f8] dark:bg-surface-overlay focus:outline-none focus:ring-1 focus:ring-primary-soft placeholder:text-text-ghost"
                />
                <span className="text-text-ghost text-[10px]">→</span>
                <input
                  type="text"
                  value={entry.target}
                  onChange={(e) => handleUpdateTerm(i, "target", e.target.value)}
                  onBlur={() => onGlossaryChange(glossary)}
                  placeholder="译文"
                  className="min-w-0 flex-1 text-[11px] border border-border-subtle rounded-md px-2 py-1 bg-[#f8f8f8] dark:bg-surface-overlay focus:outline-none focus:ring-1 focus:ring-primary-soft placeholder:text-text-ghost"
                />
                <button
                  onClick={() => handleDeleteTerm(i)}
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[9px] text-text-disabled hover:text-danger hover:bg-danger-soft transition-all"
                  title="删除术语"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {glossary.length === 0 && (
          <p className="text-[10px] text-text-ghost">添加固定翻译术语，如 "AI" → "人工智能"</p>
        )}
      </div>
    </div>
  );
}
