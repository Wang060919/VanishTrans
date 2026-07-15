import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { History, Maximize2, Minus, Pin, Settings, Square, X } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import IconButton from "../components/IconButton";
import LanguageSwitcher from "../components/LanguageSwitcher";
import OverlayDrawer from "../components/OverlayDrawer";
import VanishMark from "../components/brand/VanishMark";
import HistoryPanel from "../features/HistoryPanel";
import SettingsPanel from "../features/SettingsPanel";
import TranslatePanel from "../features/TranslatePanel";
import type { GlossaryEntry, HotkeyEntry } from "../hooks/useConfig";
import { useTheme } from "../hooks/useTheme";
import type { LangDirection } from "../hooks/useTranslation";
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
  fileStatus: string | null;
  onTranslateFile: (filename: string, content: string) => void;
  translationKey: number;
}

type ActivePanel = "settings" | "history" | null;

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
  fileStatus, onTranslateFile,
  translationKey,
}: MainLayoutProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [historyRecords, setHistoryRecords] = useState<TranslationRecord[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme, setTheme } = useTheme();

  const loadHistory = useCallback(async (query?: string) => {
    const records = await invoke<TranslationRecord[]>("get_history", { query: query || null });
    setHistoryRecords(records ?? []);
  }, []);

  const openHistory = useCallback(async () => {
    if (activePanel === "history") {
      setActivePanel(null);
      return;
    }
    await loadHistory(historySearch || undefined);
    setActivePanel("history");
  }, [activePanel, historySearch, loadHistory]);

  const openSettings = useCallback(() => {
    setActivePanel((current) => current === "settings" ? null : "settings");
  }, []);

  const handleHistorySearch = useCallback((query: string) => {
    setHistorySearch(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadHistory(query || undefined), 200);
  }, [loadHistory]);

  const handleMinimize = useCallback(async () => {
    try { await getCurrentWindow().minimize(); } catch (e) { console.error("minimize failed", e); }
  }, []);
  const handleMaximize = useCallback(async () => {
    try { await getCurrentWindow().toggleMaximize(); } catch (e) { console.error("maximize failed", e); }
  }, []);
  const handleClose = useCallback(async () => {
    try { await getCurrentWindow().close(); } catch (e) { console.error("close failed", e); }
  }, []);

  // Custom drag: startDragging is more reliable than -webkit-app-region
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    // Only drag on the header background, not on buttons
    if ((e.target as HTMLElement).closest("button, .window-controls")) return;
    try { await getCurrentWindow().startDragging(); } catch (_) {}
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header" onMouseDown={handleDragStart}>
        <div className="app-brand"><VanishMark /></div>
        <div className="app-header-actions">
          <IconButton icon={<Pin size={15} />} label={pinned ? "取消窗口置顶" : "窗口置顶"} active={pinned} onClick={onPin} />
          <IconButton icon={<History size={15} />} label="打开历史记录" active={activePanel === "history"} onClick={openHistory} />
          <IconButton icon={<Settings size={15} />} label="打开设置" active={activePanel === "settings"} onClick={openSettings} title="API 设置" />
          <div className="window-controls">
            <button className="window-controls__btn" onClick={handleMinimize} title="最小化"><Minus size={14} /></button>
            <button className="window-controls__btn" onClick={handleMaximize} title="最大化"><Square size={11} /></button>
            <button className="window-controls__btn window-controls__btn--close" onClick={handleClose} title="关闭"><X size={14} /></button>
          </div>
        </div>
      </header>

      <LanguageSwitcher value={direction} onChange={onDirectionChange} />

      <TranslatePanel
        inputText={inputText}
        onInputChange={onInputChange}
        outputText={outputText}
        loading={loading}
        glowActive={glowActive}
        onClearGlow={onClearGlow}
        onTranslate={onTranslate}
        inputRef={inputRef}
        streaming={streaming}
        fileStatus={fileStatus}
        onTranslateFile={onTranslateFile}
        translationKey={translationKey}
      />

      <footer className="app-footer">
        <div className="footer-shortcuts">
          <span><kbd>Alt+Q</kbd><b>呼出</b></span>
          <span><kbd>Alt+W</kbd><b>截图</b></span>
        </div>
        <span className={`window-status ${pinned ? "window-status--active" : ""}`}>
          <i />{loading ? "正在翻译" : pinned ? "已置顶" : "自动隐藏"}
        </span>
      </footer>

      <OverlayDrawer open={activePanel === "history"} title="翻译历史" onClose={() => setActivePanel(null)}>
        <HistoryPanel
          records={historyRecords}
          search={historySearch}
          onSearch={handleHistorySearch}
          onCopy={(text) => invoke("write_clipboard_safe", { text })}
          onDelete={async (id) => { await invoke("delete_history_record", { id }); await loadHistory(historySearch || undefined); }}
          onClear={async () => { await invoke("clear_history"); await loadHistory(); }}
        />
      </OverlayDrawer>

      <OverlayDrawer open={activePanel === "settings"} title="设置" onClose={() => setActivePanel(null)}>
        <SettingsPanel
          baseUrl={baseUrl}
          onBaseUrlChange={onBaseUrlChange}
          model={model}
          onModelChange={onModelChange}
          hasStoredApiKey={hasStoredApiKey}
          apiKeyUpdate={apiKeyUpdate}
          onApiKeyChange={onApiKeyChange}
          onSave={onSaveConfig}
          glossary={glossary}
          onGlossaryChange={onGlossaryChange}
          hotkeys={hotkeys}
          hotkeyLabels={hotkeyLabels}
          onHotkeysChange={onHotkeysChange}
          theme={theme}
          onThemeChange={setTheme}
        />
      </OverlayDrawer>
    </div>
  );
}
