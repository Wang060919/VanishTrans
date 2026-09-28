import { Server } from "lucide-react";
import { useCallback, useState } from "react";
import SettingInput from "../../components/SettingInput";
import ToggleSwitch from "../../components/ToggleSwitch";
import SaveIndicator from "../../components/SaveIndicator";
import { errorMessage } from "../../lib/errors";
import type { ServiceProfile } from "../../types";
import ProfileSection from "./ProfileSection";

interface ApiTabProps {
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  hasStoredApiKey: boolean;
  apiKeyUpdate: string | null;
  onApiKeyChange: (v: string | null) => void;
  onSave: (forcedApiKey?: string) => Promise<void>;
  profiles: ServiceProfile[];
  onSaveProfile: (profile: ServiceProfile) => Promise<ServiceProfile[]>;
  onDeleteProfile: (name: string) => Promise<ServiceProfile[]>;
  onApplyProfile: (name: string) => Promise<ServiceProfile>;
  onTestConnection: () => Promise<string>;
  freeTranslation: boolean;
  onSetFreeTranslation: (enabled: boolean) => Promise<void>;
  saved: boolean;
  notifySaved: () => void;
  notifyError: (error: unknown) => void;
}

/** API tab: model connection, credentials, connection test and profiles. */
export default function ApiTab({
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyUpdate, onApiKeyChange, onSave,
  profiles, onSaveProfile, onDeleteProfile, onApplyProfile, onTestConnection,
  freeTranslation, onSetFreeTranslation,
  saved, notifySaved, notifyError,
}: ApiTabProps) {
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; message: string } | null>(null);

  const saveConfig = useCallback(
    async (forcedApiKey?: string) => {
      try {
        await onSave(forcedApiKey);
        notifySaved();
      } catch (error) {
        notifyError(error);
      }
    },
    [notifyError, notifySaved, onSave]
  );

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

  const handleSetFreeTranslation = useCallback(
    async (enabled: boolean) => {
      try {
        await onSetFreeTranslation(enabled);
      } catch (error) {
        notifyError(error);
      }
    },
    [notifyError, onSetFreeTranslation]
  );

  return (
    <section className="settings-section" aria-labelledby="api-settings-title">
      <div className="settings-section-heading">
        <Server size={17} aria-hidden="true" />
        <div><h3 id="api-settings-title">模型连接</h3><p>连接任意兼容 OpenAI API 的服务。</p></div>
      </div>
      <div className="setting-field">
        <label htmlFor="free-translation-toggle">免费翻译（Google）</label>
        <div className="setting-inline">
          <ToggleSwitch
            id="free-translation-toggle"
            checked={freeTranslation}
            onChange={(next) => void handleSetFreeTranslation(next)}
          />
          <span className="setting-hint">{freeTranslation ? "已开启" : "已关闭"}</span>
        </div>
        <p className="setting-hint">开启后使用 Google 免费翻译（无需 API Key），下方的 Base URL / Key / 模型将被忽略。</p>
      </div>
      <SettingInput
        label="Base URL"
        value={baseUrl}
        onChange={(event) => onBaseUrlChange(event.target.value)}
        onBlur={() => void saveConfig()}
        placeholder="https://api.openai.com"
      />
      <div className="setting-field">
        <label htmlFor="api-key">API Key</label>
        <div className="setting-inline">
          <input
            id="api-key"
            type="password"
            value={apiKeyUpdate ?? ""}
            onChange={(event) => onApiKeyChange(event.target.value)}
            onBlur={() => void saveConfig()}
            placeholder={hasStoredApiKey ? "已安全保存，输入新 Key 可替换" : "sk-..."}
          />
          {hasStoredApiKey && apiKeyUpdate === null && (
            <button type="button" className="secondary-button" onClick={() => void saveConfig("")}>清除</button>
          )}
        </div>
      </div>
      <SettingInput
        label="模型名称"
        value={model}
        onChange={(event) => onModelChange(event.target.value)}
        onBlur={() => void saveConfig()}
        placeholder="gpt-4o-mini"
      />
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
      <ProfileSection
        profiles={profiles}
        baseUrl={baseUrl}
        model={model}
        onSaveProfile={onSaveProfile}
        onDeleteProfile={onDeleteProfile}
        onApplyProfile={onApplyProfile}
        notifySaved={notifySaved}
        notifyError={notifyError}
      />
      <SaveIndicator saved={saved} />
    </section>
  );
}
