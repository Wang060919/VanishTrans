import { Check, KeyRound, Plus, Server, Shield, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import HotkeyEditor from "../components/HotkeyEditor";
import SettingInput from "../components/SettingInput";
import type { GlossaryEntry, HotkeyEntry, ServiceProfile } from "../hooks/useConfig";
import { errorMessage } from "../lib/errors";
import TmPanel from "./TmPanel";

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
  const [draftGlossary, setDraftGlossary] = useState(glossary);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tmSearch, setTmSearch] = useState("");
  const [profileName, setProfileName] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glossaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glossaryDraftRef = useRef(draftGlossary);
  const onGlossaryChangeRef = useRef(onGlossaryChange);
  const userEditedRef = useRef(false);

  useEffect(() => {
    onGlossaryChangeRef.current = onGlossaryChange;
  }, [onGlossaryChange]);

  useEffect(() => {
    if (!userEditedRef.current) setDraftGlossary(glossary);
  }, [glossary]);
  useEffect(() => setActiveTab(initialTab), [initialTab]);
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (glossaryTimerRef.current) {
      // Flush the pending debounced edit before the panel unmounts.
      clearTimeout(glossaryTimerRef.current);
      void onGlossaryChangeRef.current(glossaryDraftRef.current).catch(() => {});
    }
  }, []);

  const reportError = useCallback((error: unknown) => {
    setSaved(false);
    setSaveError(errorMessage(error) || "保存失败，请重试");
  }, []);

  const saveConfig = useCallback(async (forcedApiKey?: string) => {
    try {
      await onSave(forcedApiKey);
      setSaveError("");
      setSaved(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaved(false), 1000);
    } catch (error) {
      reportError(error);
    }
  }, [onSave, reportError]);

  const handleHotkeyChange = useCallback(async (action: string, shortcut: string) => {
    try {
      await onHotkeysChange(hotkeys.map((entry) => entry.action === action ? { ...entry, shortcut } : entry));
      setSaveError("");
    } catch (error) {
      reportError(error);
    }
  }, [hotkeys, onHotkeysChange, reportError]);

  const persistGlossary = useCallback(async (entries: GlossaryEntry[]) => {
    try {
      await onGlossaryChange(entries);
      setSaveError("");
    } catch (error) {
      reportError(error);
    }
  }, [onGlossaryChange, reportError]);

  const runConnectionTest = useCallback(async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const message = await onTestConnection();
      setConnectionResult({ ok: true, message });
    } catch (error) {
      setConnectionResult({ ok: false, message: errorMessage(error) || "连接失败" });
    } finally {
      setTestingConnection(false);
    }
  }, [onTestConnection]);

  const handleSaveProfile = useCallback(async () => {
    const name = profileName.trim();
    if (!name) {
      setSaveError("请输入档案名称");
      return;
    }
    try {
      await onSaveProfile({ name, baseUrl: baseUrl.trim(), model: model.trim() });
      setProfileName("");
      setSaveError("");
      setSaved(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaved(false), 1000);
    } catch (error) {
      reportError(error);
    }
  }, [baseUrl, model, onSaveProfile, profileName, reportError]);

  const handleApplyProfile = useCallback(async (name: string) => {
    try {
      await onApplyProfile(name);
      setSaveError("");
    } catch (error) {
      reportError(error);
    }
  }, [onApplyProfile, reportError]);

  const handleDeleteProfile = useCallback(async (name: string) => {
    try {
      await onDeleteProfile(name);
      setSaveError("");
    } catch (error) {
      reportError(error);
    }
  }, [onDeleteProfile, reportError]);

  const handleSetLogging = useCallback(async (enabled: boolean) => {
    try {
      await onSetLogging(enabled);
      setSaveError("");
    } catch (error) {
      reportError(error);
    }
  }, [onSetLogging, reportError]);

  const handleSetFreeTranslation = useCallback(async (enabled: boolean) => {
    try {
      await onSetFreeTranslation(enabled);
      setSaveError("");
    } catch (error) {
      reportError(error);
    }
  }, [onSetFreeTranslation, reportError]);

  const scheduleGlossarySave = useCallback((entries: GlossaryEntry[]) => {
    glossaryDraftRef.current = entries;
    if (glossaryTimerRef.current) clearTimeout(glossaryTimerRef.current);
    glossaryTimerRef.current = setTimeout(() => {
      void persistGlossary(glossaryDraftRef.current);
    }, 400);
  }, [persistGlossary]);

  const addTerm = () => {
    const next = [...draftGlossary, { source: "", target: "" }];
    setDraftGlossary(next);
  };

  const deleteTerm = (index: number) => {
    userEditedRef.current = true;
    const next = draftGlossary.filter((_, itemIndex) => itemIndex !== index);
    setDraftGlossary(next);
    scheduleGlossarySave(next);
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
        {saveError && <div className="save-indicator save-indicator--visible save-indicator--error" role="alert">{saveError}</div>}
        {activeTab === "api" && (
          <section className="settings-section" aria-labelledby="api-settings-title">
            <div className="settings-section-heading">
              <Server size={17} aria-hidden="true" />
              <div><h3 id="api-settings-title">模型连接</h3><p>连接任意兼容 OpenAI API 的服务。</p></div>
            </div>
            <div className="setting-field">
              <label htmlFor="free-translation-toggle">免费翻译（Google）</label>
              <div className="setting-inline">
                <button
                  id="free-translation-toggle"
                  type="button"
                  role="switch"
                  aria-checked={freeTranslation}
                  className="toggle-switch"
                  onClick={() => void handleSetFreeTranslation(!freeTranslation)}
                >
                  <span className="toggle-thumb" />
                </button>
                <span className="setting-hint">{freeTranslation ? "已开启" : "已关闭"}</span>
              </div>
              <p className="setting-hint">开启后使用 Google 免费翻译（无需 API Key），下方的 Base URL / Key / 模型将被忽略。</p>
            </div>
            <SettingInput label="Base URL" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} onBlur={() => void saveConfig()} placeholder="https://api.openai.com" />
            <div className="setting-field">
              <label htmlFor="api-key">API Key</label>
              <div className="setting-inline">
                <input id="api-key" type="password" value={apiKeyUpdate ?? ""} onChange={(event) => onApiKeyChange(event.target.value)} onBlur={() => void saveConfig()} placeholder={hasStoredApiKey ? "已安全保存，输入新 Key 可替换" : "sk-..."} />
                {hasStoredApiKey && apiKeyUpdate === null && <button type="button" className="secondary-button" onClick={() => void saveConfig("")}>清除</button>}
              </div>
            </div>
            <SettingInput label="模型名称" value={model} onChange={(event) => onModelChange(event.target.value)} onBlur={() => void saveConfig()} placeholder="gpt-4o-mini" />
            <div className="setting-field">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void runConnectionTest()}
                disabled={testingConnection}
              >
                {testingConnection ? "测试中..." : "测试连接"}
              </button>
              {connectionResult && (
                <span className={connectionResult.ok ? "connection-result connection-result--ok" : "connection-result connection-result--error"}>
                  {connectionResult.message}
                </span>
              )}
            </div>
            <div className="setting-field">
              <label htmlFor="profile-name">保存为服务档案</label>
              <div className="setting-inline">
                <input
                  id="profile-name"
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="如：OpenAI / DeepSeek / 本地 Ollama"
                />
                <button type="button" className="secondary-button" onClick={() => void handleSaveProfile()}>保存档案</button>
              </div>
            </div>
            {profiles.length > 0 && (
              <div className="profile-list">
                {profiles.map((profile) => (
                  <div className="profile-row" key={profile.name}>
                    <span className="profile-name">{profile.name}</span>
                    <span className="profile-meta">{profile.baseUrl} · {profile.model}</span>
                    <button type="button" className="secondary-button" onClick={() => void handleApplyProfile(profile.name)}>应用</button>
                    <button type="button" className="text-action text-action--danger" aria-label={`删除档案 ${profile.name}`} onClick={() => void handleDeleteProfile(profile.name)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={`save-indicator ${saved ? "save-indicator--visible" : ""}`} role="status"><Check size={13} />设置已保存</div>
          </section>
        )}

        {activeTab === "hotkeys" && (
          <section className="settings-section" aria-labelledby="hotkey-settings-title">
            <div className="settings-section-heading"><KeyRound size={17} /><div><h3 id="hotkey-settings-title">全局快捷键</h3><p>在其他应用中也可以呼出 VanishTrans。</p></div></div>
            <div className="hotkey-list">
              {hotkeys.map((entry) => <HotkeyEditor key={entry.action} label={hotkeyLabels[entry.action] || entry.action} value={entry.shortcut} onChange={(shortcut) => { void handleHotkeyChange(entry.action, shortcut); }} />)}
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
                  <div className="glossary-row" key={`${entry.source}-${entry.target}-${index}`}>
                    <input aria-label={`术语原文 ${index + 1}`} value={entry.source} onChange={(event) => {
                      userEditedRef.current = true;
                      const next = draftGlossary.map((e, i) => i === index ? { ...e, source: event.target.value } : e);
                      setDraftGlossary(next);
                      scheduleGlossarySave(next);
                    }} placeholder="原文" />
                    <span>→</span>
                    <input aria-label={`术语译文 ${index + 1}`} value={entry.target} onChange={(event) => {
                      userEditedRef.current = true;
                      const next = draftGlossary.map((e, i) => i === index ? { ...e, target: event.target.value } : e);
                      setDraftGlossary(next);
                      scheduleGlossarySave(next);
                    }} placeholder="译文" />
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

        {activeTab === "privacy" && (
          <section className="settings-section" aria-labelledby="privacy-settings-title">
            <div className="settings-section-heading">
              <Shield size={17} aria-hidden="true" />
              <div><h3 id="privacy-settings-title">隐私</h3><p>控制本地记录与日志行为。</p></div>
            </div>
            <div className="setting-field">
              <label htmlFor="logging-toggle">文件日志</label>
              <div className="setting-inline">
                <button
                  id="logging-toggle"
                  type="button"
                  role="switch"
                  aria-checked={loggingEnabled}
                  className="toggle-switch"
                  onClick={() => void handleSetLogging(!loggingEnabled)}
                >
                  <span className="toggle-thumb" />
                </button>
                <span className="setting-hint">{loggingEnabled ? "已开启" : "已关闭"}</span>
              </div>
              <p className="setting-hint">关闭后不再写入日志文件；翻译历史与翻译记忆仍按现有设置保存。</p>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
