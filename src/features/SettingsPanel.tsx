import { useEffect, useState } from "react";
import SaveIndicator from "../components/SaveIndicator";
import { useSaveFeedback } from "../hooks/useSaveFeedback";
import type { GlossaryEntry, HotkeyEntry, ServiceProfile } from "../types";
import ApiTab from "./settings/ApiTab";
import GlossaryTab from "./settings/GlossaryTab";
import HotkeysTab from "./settings/HotkeysTab";
import PrivacyTab from "./settings/PrivacyTab";
import TmTab from "./settings/TmTab";

interface SettingsPanelProps {
  initialTab?: SettingsTab;
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

export type SettingsTab = "api" | "hotkeys" | "glossary" | "tm" | "privacy";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "api", label: "API" },
  { id: "hotkeys", label: "快捷键" },
  { id: "glossary", label: "术语表" },
  { id: "tm", label: "翻译记忆" },
  { id: "privacy", label: "隐私" },
];

/** Settings shell: tab bar + shared save feedback. Content lives in settings/*Tab. */
export default function SettingsPanel({
  initialTab = "api",
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyUpdate, onApiKeyChange, onSave,
  glossary, onGlossaryChange,
  hotkeys, hotkeyLabels, onHotkeysChange,
  profiles, onSaveProfile, onDeleteProfile, onApplyProfile, onTestConnection,
  loggingEnabled, onSetLogging,
  freeTranslation, onSetFreeTranslation,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const { saved, saveError, notifySaved, notifyError } = useSaveFeedback();

  useEffect(() => setActiveTab(initialTab), [initialTab]);

  return (
    <div className="settings-panel">
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-scroll">
        {saveError && <SaveIndicator saved={false} error={saveError} />}
        {activeTab === "api" && (
          <ApiTab
            baseUrl={baseUrl}
            onBaseUrlChange={onBaseUrlChange}
            model={model}
            onModelChange={onModelChange}
            hasStoredApiKey={hasStoredApiKey}
            apiKeyUpdate={apiKeyUpdate}
            onApiKeyChange={onApiKeyChange}
            onSave={onSave}
            profiles={profiles}
            onSaveProfile={onSaveProfile}
            onDeleteProfile={onDeleteProfile}
            onApplyProfile={onApplyProfile}
            onTestConnection={onTestConnection}
            freeTranslation={freeTranslation}
            onSetFreeTranslation={onSetFreeTranslation}
            saved={saved}
            notifySaved={notifySaved}
            notifyError={notifyError}
          />
        )}
        {activeTab === "hotkeys" && (
          <HotkeysTab
            hotkeys={hotkeys}
            hotkeyLabels={hotkeyLabels}
            onHotkeysChange={onHotkeysChange}
            notifyError={notifyError}
          />
        )}
        {activeTab === "glossary" && (
          <GlossaryTab glossary={glossary} onGlossaryChange={onGlossaryChange} notifyError={notifyError} />
        )}
        {activeTab === "tm" && <TmTab />}
        {activeTab === "privacy" && (
          <PrivacyTab loggingEnabled={loggingEnabled} onSetLogging={onSetLogging} notifyError={notifyError} />
        )}
      </div>
    </div>
  );
}
