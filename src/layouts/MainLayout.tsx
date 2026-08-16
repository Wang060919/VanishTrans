import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Database, History, Minimize2, Minus, Pin, ScanLine, Settings, Square, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import IconButton from "../components/IconButton";
import LanguageSwitcher from "../components/LanguageSwitcher";
import OverlayDrawer from "../components/OverlayDrawer";
import VanishMark from "../components/brand/VanishMark";
import HistoryPanel from "../features/HistoryPanel";
import SettingsPanel, { type SettingsTab } from "../features/SettingsPanel";
import TranslatePanel from "../features/TranslatePanel";
import type { GlossaryEntry, HotkeyEntry, ServiceProfile } from "../hooks/useConfig";
import { useTheme } from "../hooks/useTheme";
import type { LangDirection } from "../hooks/useTranslation";
import { logError } from "../lib/logger";
import type { TranslationRecord } from "../types";

interface MainLayoutProps {
  embedded?: boolean;
  notices?: string[];
  onDismissNotice?: (message: string) => void;
  onCollapse?: () => void | Promise<void>;
  onWindowDragStart?: () => boolean | void;
  onWindowDragEnd?: () => void;
  onWindowMoved?: () => void | Promise<void>;
  inputText: string;
  onInputChange: (v: string) => void;
  outputText: string;
  translationError?: string | null;
  loading: boolean;
  pinned: boolean;
  onPin: () => void;
  direction: LangDirection;
  onDirectionChange: (d: LangDirection) => void;
  glowActive: boolean;
  onClearGlow: () => void;
  onTranslate: (forceRefresh?: boolean) => void;
  onCancelTranslation?: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  hasStoredApiKey: boolean;
  apiKeyUpdate: string | null;
  onApiKeyChange: (v: string | null) => void;
  onSaveConfig: (forcedApiKey?: string) => Promise<void>;
  glossary: GlossaryEntry[];
  onGlossaryChange: (entries: GlossaryEntry[]) => Promise<void>;
  hotkeys: HotkeyEntry[];
  hotkeyLabels: Record<string, string>;
  onHotkeysChange: (entries: HotkeyEntry[]) => Promise<void>;
  profiles: ServiceProfile[];
  onSaveProfile: (profile: ServiceProfile) => Promise<ServiceProfile[]>;
  onDeleteProfile: (name: string) => Promise<ServiceProfile[]>;
  onApplyProfile: (name: string) => Promise<ServiceProfile>;
  onTestConnection: () => Promise<string>;
  loggingEnabled: boolean;
  onSetLogging: (enabled: boolean) => Promise<void>;
  freeTranslation: boolean;
  onSetFreeTranslation: (enabled: boolean) => Promise<void>;
  streaming: boolean;
  fileStatus: string | null;
  onTranslateFile: (filename: string, content: string) => void;
  translationKey: number;
}

type ActivePanel = "settings" | "history" | null;

export default function MainLayout({
  embedded = false,
  notices = [],
  onDismissNotice,
  onCollapse,
  onWindowDragStart,
  onWindowDragEnd,
  onWindowMoved,
  inputText, onInputChange,
  outputText, translationError = null, loading,
  pinned, onPin,
  direction, onDirectionChange,
  glowActive, onClearGlow,
  onTranslate, onCancelTranslation, inputRef,
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyUpdate, onApiKeyChange, onSaveConfig,
  glossary, onGlossaryChange,
  hotkeys, hotkeyLabels, onHotkeysChange,
  profiles, onSaveProfile, onDeleteProfile, onApplyProfile, onTestConnection,
  loggingEnabled, onSetLogging,
  freeTranslation, onSetFreeTranslation,
  streaming,
  fileStatus, onTranslateFile,
  translationKey,
}: MainLayoutProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [historyRecords, setHistoryRecords] = useState<TranslationRecord[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("api");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useTheme();

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
    setSettingsTab("api");
    setActivePanel((current) => current === "settings" ? null : "settings");
  }, []);

  const openTranslationMemory = useCallback(() => {
    setSettingsTab("tm");
    setActivePanel("settings");
  }, []);

  const copyText = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await invoke("write_clipboard_safe", { text });
    } catch (error) {
      logError("main", "copy translation text failed", error);
    }
  }, []);

  const startScreenshot = useCallback(async () => {
    try {
      await invoke("start_screenshot_from_ball");
    } catch (error) {
      logError("main", "start screenshot translation failed", error);
    }
  }, []);

  const handleHistorySearch = useCallback((query: string) => {
    setHistorySearch(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadHistory(query || undefined), 200);
  }, [loadHistory]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    if (embedded) {
      await onCollapse?.();
      return;
    }
    try { await getCurrentWindow().minimize(); } catch (e) { logError("main.window", "minimize failed", e); }
  }, [embedded, onCollapse]);
  const handleMaximize = useCallback(async () => {
    try { await getCurrentWindow().toggleMaximize(); } catch (e) { logError("main.window", "maximize failed", e); }
  }, []);
  const handleClose = useCallback(async () => {
    try { await invoke("hide_window"); } catch (e) { logError("main.window", "hide failed", e); }
  }, []);

  // Drag: use startDragging() with permission, fallback to data-tauri-drag-region
  const handleHeaderMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0
      || (e.target as HTMLElement).closest("button, .window-controls, select, input, a")) return;
    if (onWindowDragStart?.() === false) return;
    try {
      await getCurrentWindow().startDragging();
      await onWindowMoved?.();
    } catch {
      // Native dragging can be unavailable in a browser-only preview.
    } finally {
      onWindowDragEnd?.();
    }
  }, [onWindowDragEnd, onWindowDragStart, onWindowMoved]);

  return (
    <div className={`app-shell ${embedded ? "app-shell--island" : ""}`}>
      <header className="app-header" onMouseDown={handleHeaderMouseDown}>
        <div className="app-brand"><VanishMark /></div>
        <div className="app-header-actions">
          <IconButton icon={<Pin size={15} />} label={pinned ? "取消窗口置顶" : "窗口置顶"} active={pinned} onClick={onPin} />
          <IconButton icon={<History size={15} />} label="打开历史记录" active={activePanel === "history"} onClick={openHistory} />
          <IconButton icon={<Settings size={15} />} label="打开设置" active={activePanel === "settings"} onClick={openSettings} title="API 设置" />
          <div className="window-controls">
            <button className="window-controls__btn" onClick={handleMinimize} title={embedded ? "收起为灵动岛" : "最小化"}>
              {embedded ? <Minimize2 size={13} /> : <Minus size={14} />}
            </button>
            {!embedded && <button className="window-controls__btn" onClick={handleMaximize} title="最大化"><Square size={11} /></button>}
            <button className="window-controls__btn window-controls__btn--close" onClick={handleClose} title="关闭"><X size={14} /></button>
          </div>
        </div>
      </header>

      {notices.length > 0 && (
        <div className="app-notices" role="status" aria-live="polite">
          {notices.map((message) => (
            <div className="app-notice" key={message}>
              <span>{message}</span>
              <button type="button" onClick={() => onDismissNotice?.(message)} aria-label="关闭提示">
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <LanguageSwitcher value={direction} onChange={onDirectionChange} disabled={loading} />

      <TranslatePanel
        inputText={inputText}
        onInputChange={onInputChange}
        outputText={outputText}
        error={translationError}
        loading={loading}
        glowActive={glowActive}
        onClearGlow={onClearGlow}
        onTranslate={onTranslate}
        onCancel={onCancelTranslation}
        inputRef={inputRef}
        streaming={streaming}
        fileStatus={fileStatus}
        onTranslateFile={onTranslateFile}
        translationKey={translationKey}
      />

      <footer className="app-footer">
        {embedded ? (
          <nav className="workspace-footer-actions" aria-label="翻译操作">
            <button type="button" disabled={!inputText} onClick={() => void copyText(inputText)}>
              <Copy size={13} aria-hidden="true" /><span>复制原文</span>
            </button>
            <button type="button" disabled={!outputText || outputText.startsWith("❌")} onClick={() => void copyText(outputText)}>
              <Copy size={13} aria-hidden="true" /><span>复制译文</span>
            </button>
            <button type="button" onClick={() => void startScreenshot()}>
              <ScanLine size={13} aria-hidden="true" /><span>智能选读</span>
            </button>
            <button type="button" onClick={openTranslationMemory}>
              <Database size={13} aria-hidden="true" /><span>翻译记忆</span>
            </button>
          </nav>
        ) : (
          <div className="footer-shortcuts">
            <span><kbd>Alt+Q</kbd><b>呼出</b></span>
            <span><kbd>Alt+W</kbd><b>截图</b></span>
          </div>
        )}
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
          initialTab={settingsTab}
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
          profiles={profiles}
          onSaveProfile={onSaveProfile}
          onDeleteProfile={onDeleteProfile}
          onApplyProfile={onApplyProfile}
          onTestConnection={onTestConnection}
          loggingEnabled={loggingEnabled}
          onSetLogging={onSetLogging}
          freeTranslation={freeTranslation}
          onSetFreeTranslation={onSetFreeTranslation}
        />
      </OverlayDrawer>
    </div>
  );
}
