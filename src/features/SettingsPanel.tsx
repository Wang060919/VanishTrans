import { Check, Database, KeyRound, Moon, Plus, Server, Sun, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import HotkeyEditor from "../components/HotkeyEditor";
import SettingInput from "../components/SettingInput";
import type { GlossaryEntry, HotkeyEntry } from "../hooks/useConfig";
import type { ThemeMode } from "../hooks/useTheme";
import TmPanel from "./TmPanel";

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
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

type SettingsTab = "api" | "hotkeys" | "glossary" | "tm" | "appearance";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "api", label: "API" },
  { id: "hotkeys", label: "快捷键" },
  { id: "glossary", label: "术语表" },
  { id: "tm", label: "翻译记忆" },
  { id: "appearance", label: "外观" },
];

export default function SettingsPanel({
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyUpdate, onApiKeyChange, onSave,
  glossary, onGlossaryChange,
  hotkeys, hotkeyLabels, onHotkeysChange,
  theme, onThemeChange,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");
  const [draftGlossary, setDraftGlossary] = useState(glossary);
  const [saved, setSaved] = useState(false);
  const [tmSearch, setTmSearch] = useState("");

  useEffect(() => setDraftGlossary(glossary), [glossary]);

  const saveConfig = useCallback((forcedApiKey?: string) => {
    onSave(forcedApiKey);
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 1000);
    return () => clearTimeout(timer);
  }, [onSave]);

  const handleHotkeyChange = useCallback((action: string, shortcut: string) => {
    onHotkeysChange(hotkeys.map((entry) => entry.action === action ? { ...entry, shortcut } : entry));
  }, [hotkeys, onHotkeysChange]);

  const updateTerm = (index: number, field: keyof GlossaryEntry, value: string) => {
    setDraftGlossary((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: value } : entry));
  };

  const addTerm = () => {
    const next = [...draftGlossary, { source: "", target: "" }];
    setDraftGlossary(next);
  };

  const deleteTerm = (index: number) => {
    const next = draftGlossary.filter((_, itemIndex) => itemIndex !== index);
    setDraftGlossary(next);
    onGlossaryChange(next);
  };

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
        {activeTab === "api" && (
          <section className="settings-section" aria-labelledby="api-settings-title">
            <div className="settings-section-heading">
              <Server size={17} aria-hidden="true" />
              <div><h3 id="api-settings-title">模型连接</h3><p>连接任意兼容 OpenAI API 的服务。</p></div>
            </div>
            <SettingInput label="Base URL" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} onBlur={() => saveConfig()} placeholder="https://api.openai.com" />
            <div className="setting-field">
              <label htmlFor="api-key">API Key</label>
              <div className="setting-inline">
                <input id="api-key" type="password" value={apiKeyUpdate ?? ""} onChange={(event) => onApiKeyChange(event.target.value)} onBlur={() => saveConfig()} placeholder={hasStoredApiKey ? "已安全保存，输入新 Key 可替换" : "sk-..."} />
                {hasStoredApiKey && apiKeyUpdate === null && <button type="button" className="secondary-button" onClick={() => saveConfig("")}>清除</button>}
              </div>
            </div>
            <SettingInput label="模型名称" value={model} onChange={(event) => onModelChange(event.target.value)} onBlur={() => saveConfig()} placeholder="gpt-4o-mini" />
            <div className={`save-indicator ${saved ? "save-indicator--visible" : ""}`} role="status"><Check size={13} />设置已保存</div>
          </section>
        )}

        {activeTab === "hotkeys" && (
          <section className="settings-section" aria-labelledby="hotkey-settings-title">
            <div className="settings-section-heading"><KeyRound size={17} /><div><h3 id="hotkey-settings-title">全局快捷键</h3><p>在其他应用中也可以呼出 VanishTrans。</p></div></div>
            <div className="hotkey-list">
              {hotkeys.map((entry) => <HotkeyEditor key={entry.action} label={hotkeyLabels[entry.action] || entry.action} value={entry.shortcut} onChange={(shortcut) => handleHotkeyChange(entry.action, shortcut)} />)}
            </div>
          </section>
        )}

        {activeTab === "glossary" && (
          <section className="settings-section" aria-labelledby="glossary-settings-title">
            <div className="settings-section-heading settings-section-heading--action">
              <div><h3 id="glossary-settings-title">固定术语</h3><p>为品牌名和专业词汇指定稳定译法。</p></div>
              <button type="button" className="secondary-button" onClick={addTerm}><Plus size={14} />添加</button>
            </div>
            {draftGlossary.length === 0 ? <div className="settings-empty">还没有术语。添加后会在翻译提示中自动应用。</div> : (
              <div className="glossary-list">
                {draftGlossary.map((entry, index) => (
                  <div className="glossary-row" key={index}>
                    <input aria-label={`术语原文 ${index + 1}`} value={entry.source} onChange={(event) => updateTerm(index, "source", event.target.value)} onBlur={() => onGlossaryChange(draftGlossary)} placeholder="原文" />
                    <span>→</span>
                    <input aria-label={`术语译文 ${index + 1}`} value={entry.target} onChange={(event) => updateTerm(index, "target", event.target.value)} onBlur={() => onGlossaryChange(draftGlossary)} placeholder="译文" />
                    <button type="button" aria-label={`删除术语 ${index + 1}`} onClick={() => deleteTerm(index)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "tm" && (
          <section className="settings-section" style={{ padding: 0, overflow: "hidden" }}>
            <TmPanel searchQuery={tmSearch} onSearchChange={setTmSearch} />
          </section>
        )}

        {activeTab === "appearance" && (
          <section className="settings-section" aria-labelledby="appearance-settings-title">
            <div className="settings-section-heading"><Sun size={17} /><div><h3 id="appearance-settings-title">界面主题</h3><p>默认跟随 Windows 外观设置。</p></div></div>
            <div className="theme-options" role="radiogroup" aria-label="界面主题">
              {(["system", "light", "dark"] as ThemeMode[]).map((option) => (
                <button key={option} type="button" role="radio" aria-checked={theme === option} onClick={() => onThemeChange(option)}>
                  {option === "dark" ? <Moon size={16} /> : <Sun size={16} />}
                  <span>{option === "system" ? "跟随系统" : option === "light" ? "浅色" : "深色"}</span>
                  {theme === option && <Check size={14} className="theme-check" />}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
