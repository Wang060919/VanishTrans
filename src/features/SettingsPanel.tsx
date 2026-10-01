import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, Database, Info, Keyboard, Server, Shield } from "lucide-react";
import { useSaveFeedback } from "../hooks/useSaveFeedback";
import type { GlossaryEntry, HotkeyEntry, ServiceProfile } from "../types";
import AboutTab from "./settings/AboutTab";
import ApiTab from "./settings/ApiTab";
import GlossaryTab from "./settings/GlossaryTab";
import HotkeysTab from "./settings/HotkeysTab";
import PrivacyTab from "./settings/PrivacyTab";
import TmTab from "./settings/TmTab";

interface SettingsPanelProps {
  initialTab?: SettingsTab;
  page?: SettingsTab | null;
  onPageChange?: (page: SettingsTab | null) => void;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  hasStoredApiKey: boolean;
  apiKeyUpdate: string | null;
  onApiKeyChange: (v: string | null) => void;
  onSave: (forcedApiKey?: string) => Promise<void>;
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
}

export type SettingsTab = "api" | "hotkeys" | "glossary" | "tm" | "privacy" | "about";

export const SETTINGS_PAGES = [
  { id: "api", label: "翻译服务", icon: Server },
  { id: "hotkeys", label: "快捷键", icon: Keyboard },
  { id: "glossary", label: "术语表", icon: BookOpen },
  { id: "tm", label: "翻译记忆", icon: Database },
  { id: "privacy", label: "隐私", icon: Shield },
  { id: "about", label: "关于", icon: Info },
] as const;

/** Native grouped navigation + shared save feedback. Content lives in settings/*Tab. */
export default function SettingsPanel({
  initialTab, page, onPageChange,
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyUpdate, onApiKeyChange, onSave,
  glossary, onGlossaryChange,
  hotkeys, hotkeyLabels, onHotkeysChange,
  profiles, onSaveProfile, onDeleteProfile, onApplyProfile, onTestConnection,
  loggingEnabled, onSetLogging,
  freeTranslation, onSetFreeTranslation,
}: SettingsPanelProps) {
  const [localPage, setLocalPage] = useState<SettingsTab | null>(initialTab ?? null);
  const activeTab = page === undefined ? localPage : page;
  const setActiveTab = (next: SettingsTab | null) => { setLocalPage(next); onPageChange?.(next); };
  const { saved, saving, saveError, notifyError, trackSave } = useSaveFeedback();
  const id = useId();
  const previousPage = useRef<SettingsTab | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const writes = useMemo(() => ({
    save: (key?: string) => trackSave(() => onSave(key)),
    glossary: (entries: GlossaryEntry[]) => trackSave(() => onGlossaryChange(entries)),
    hotkeys: (entries: HotkeyEntry[]) => trackSave(() => onHotkeysChange(entries)),
    logging: (enabled: boolean) => trackSave(() => onSetLogging(enabled)),
    free: (enabled: boolean) => trackSave(() => onSetFreeTranslation(enabled)),
    saveProfile: (profile: ServiceProfile) => trackSave(() => onSaveProfile(profile)),
    deleteProfile: (name: string) => trackSave(() => onDeleteProfile(name)),
    applyProfile: (name: string) => trackSave(() => onApplyProfile(name)),
  }), [trackSave, onSave, onGlossaryChange, onHotkeysChange, onSetLogging,
    onSetFreeTranslation, onSaveProfile, onDeleteProfile, onApplyProfile]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [activeTab]);
  useEffect(() => { setLocalPage(initialTab ?? null); }, [initialTab]);
  useEffect(() => {
    if (activeTab) scrollRef.current?.focus();
    else if (previousPage.current) document.getElementById(id + "-" + previousPage.current)?.focus();
    previousPage.current = activeTab;
  }, [activeTab, id]);

  return (
    <div className="settings-panel">
      {activeTab === null && <nav className="settings-home" aria-label="设置分类">
        <div className="settings-home-list">
          {SETTINGS_PAGES.map((tab) => <button key={tab.id} id={id + "-" + tab.id} type="button"
            onClick={() => setActiveTab(tab.id)} aria-label={tab.label}>
            <tab.icon size={19} strokeWidth={1.7} aria-hidden="true" />
            <span>{tab.label}</span><ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div>
      </nav>}
      {activeTab !== null && <div className="settings-content">
      {page === undefined && <button type="button" className="settings-back text-action" onClick={() => setActiveTab(null)}>返回设置</button>}
      <div ref={scrollRef} className="settings-scroll" role="region" id={id + "-panel"}
        aria-label={SETTINGS_PAGES.find((tab) => tab.id === activeTab)?.label + "设置"} tabIndex={-1}>
        {activeTab === "api" && (
          <ApiTab
            baseUrl={baseUrl}
            onBaseUrlChange={onBaseUrlChange}
            model={model}
            onModelChange={onModelChange}
            hasStoredApiKey={hasStoredApiKey}
            apiKeyUpdate={apiKeyUpdate}
            onApiKeyChange={onApiKeyChange}
            onSave={writes.save}
            profiles={profiles}
            onSaveProfile={writes.saveProfile}
            onDeleteProfile={writes.deleteProfile}
            onApplyProfile={writes.applyProfile}
            onTestConnection={onTestConnection}
            freeTranslation={freeTranslation}
            onSetFreeTranslation={writes.free}
            notifyError={notifyError}
          />
        )}
        {activeTab === "hotkeys" && (
          <HotkeysTab
            hotkeys={hotkeys}
            hotkeyLabels={hotkeyLabels}
            onHotkeysChange={writes.hotkeys}
            notifyError={notifyError}
          />
        )}
        {activeTab === "glossary" && (
          <GlossaryTab glossary={glossary} onGlossaryChange={writes.glossary} notifyError={notifyError} />
        )}
        {activeTab === "tm" && <TmTab />}
        {activeTab === "privacy" && (
          <PrivacyTab loggingEnabled={loggingEnabled} onSetLogging={writes.logging} notifyError={notifyError} />
        )}
        {activeTab === "about" && <AboutTab />}
      </div>
      </div>}
      <div className={"settings-feedback" + (saveError ? " settings-feedback--error" : "")}
        role="status" aria-live="polite" aria-atomic="true">
        <span className="settings-feedback-dot" data-state={saveError ? "error" : saving ? "saving" : saved ? "saved" : "idle"} />
        <span>{saveError || (saving ? "正在保存…" : saved ? "已保存" : activeTab === "tm" ? "翻译记忆保存在本机" : "更改后自动保存")}</span>
      </div>
    </div>
  );
}
