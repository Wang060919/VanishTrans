import { History, ScanLine, Settings, X } from "lucide-react";
import { useState } from "react";
import IconButton from "../components/IconButton";
import LanguageSwitcher from "../components/LanguageSwitcher";
import OverlayDrawer from "../components/OverlayDrawer";
import HistoryPanel from "../features/HistoryPanel";
import SettingsPanel, { SETTINGS_PAGES, type SettingsTab } from "../features/SettingsPanel";
import TranslatePanel from "../features/TranslatePanel";
import { useMainLayout } from "../hooks/useMainLayout";
import TranslationHeader from "./TranslationHeader";
import type { MainLayoutProps } from "./MainLayout.types";

export default function MainLayout({ shell, pinned, onPin, translation, config }: MainLayoutProps) {
  const { embedded = false, notices = [], onDismissNotice } = shell ?? {};
  const ui = useMainLayout(shell);
  const [settingsPage, setSettingsPage] = useState<SettingsTab | null>(null);
  const openSettings = () => { setSettingsPage(null); ui.openSettings(); };
  const closePanel = () => ui.setActivePanel(null);
  const settingsTitle = SETTINGS_PAGES.find((page) => page.id === settingsPage)?.label ?? "设置";

  return (
    <div className={"app-shell native-ui" + (embedded ? " app-shell--island" : "")}>
      <TranslationHeader embedded={embedded} pinned={pinned} onPin={onPin} onDrag={ui.handleHeaderMouseDown}
        onMinimize={ui.handleMinimize} onMaximize={ui.handleMaximize} onClose={ui.handleClose} />
      {notices.length > 0 && <div className="app-notices" role="status" aria-live="polite">
        {notices.map((message) => <div className="app-notice" key={message}>
          <span>{message}</span>
          <button type="button" onClick={() => onDismissNotice?.(message)} aria-label="关闭提示"><X size={13} /></button>
        </div>)}
      </div>}
      <LanguageSwitcher value={translation.direction} onChange={translation.onDirectionChange} disabled={translation.loading} />
      <TranslatePanel {...translation} error={translation.translationError} onCancel={translation.onCancelTranslation}
        actions={<>
          <IconButton icon={<ScanLine size={18} />} label="截图翻译" text="截图" onClick={() => void ui.startScreenshot()} />
          <IconButton icon={<History size={18} />} label="打开历史记录" text="历史" active={ui.activePanel === "history"} onClick={ui.openHistory} />
          <IconButton icon={<Settings size={18} />} label="打开设置" text="设置" active={ui.activePanel === "settings"} onClick={openSettings} />
        </>} />
      <OverlayDrawer fullSize onHeaderMouseDown={ui.handleHeaderMouseDown} open={ui.activePanel === "history"} title="翻译历史" onClose={closePanel}>
        <HistoryPanel records={ui.historyRecords} search={ui.historySearch} onSearch={ui.handleHistorySearch}
          onDelete={ui.handleHistoryDelete} onClear={ui.handleHistoryClear} />
      </OverlayDrawer>
      <OverlayDrawer fullSize onHeaderMouseDown={ui.handleHeaderMouseDown} open={ui.activePanel === "settings"}
        title={settingsTitle} onClose={closePanel} onBack={settingsPage ? () => setSettingsPage(null) : undefined}
        backLabel="返回设置" hideBack={!settingsPage}>
        <SettingsPanel {...config} onSave={config.onSaveConfig} page={settingsPage} onPageChange={setSettingsPage} />
      </OverlayDrawer>
    </div>
  );
}
