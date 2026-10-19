import type { ApiConfigResponse } from "../../services/tauriBridge";
import { isLinuxCore } from "../../lib/platform";
import { Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import SettingInput from "../../components/SettingInput";
import { errorMessage } from "../../lib/errors";
import type { ServiceProfile } from "../../types";
import ProfileSection from "./ProfileSection";

interface ApiTabProps {
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  hasStoredApiKey: boolean;
  apiKeyStorage?: ApiConfigResponse["apiKeyStorage"];
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
  notifyError: (error: unknown) => void;
}

/** API tab: model connection, credentials, connection test and profiles. */
export default function ApiTab({
  baseUrl, onBaseUrlChange,
  model, onModelChange,
  hasStoredApiKey, apiKeyStorage, apiKeyUpdate, onApiKeyChange, onSave,
  profiles, onSaveProfile, onDeleteProfile, onApplyProfile, onTestConnection,
  freeTranslation, onSetFreeTranslation,
  notifyError,
}: ApiTabProps) {
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [switchingProvider, setSwitchingProvider] = useState(false);
  const testGeneration = useRef(0);
  useEffect(() => {
    testGeneration.current += 1;
    setConnectionResult(null);
    setTestingConnection(false);
    return () => { testGeneration.current += 1; };
  }, [baseUrl, model, apiKeyUpdate, hasStoredApiKey, freeTranslation]);

  const saveConfig = useCallback(
    async (forcedApiKey?: string) => {
      try {
        await onSave(forcedApiKey);
      } catch (error) {
        notifyError(error);
      }
    },
    [notifyError, onSave]
  );

  const runConnectionTest = useCallback(async () => {
    const generation = ++testGeneration.current;
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const message = await onTestConnection();
      if (generation === testGeneration.current) setConnectionResult({ ok: true, message });
    } catch (error) {
      if (generation === testGeneration.current) setConnectionResult({ ok: false, message: errorMessage(error) || "连接失败" });
    } finally {
      if (generation === testGeneration.current) setTestingConnection(false);
    }
  }, [onTestConnection]);

  const handleSetFreeTranslation = useCallback(
    async (enabled: boolean) => {
      setSwitchingProvider(true);
      try {
        await onSetFreeTranslation(enabled);
      } catch (error) {
        notifyError(error);
      } finally {
        setSwitchingProvider(false);
      }
    },
    [notifyError, onSetFreeTranslation]
  );

  return (
    <section className="settings-section settings-section--api" aria-labelledby="api-settings-title">
      <div className="settings-section-heading">
        <Server size={17} aria-hidden="true" />
        <div><h3 id="api-settings-title">翻译服务</h3><p>选择日常使用的翻译方式。</p></div>
      </div>
      <div className="provider-selector" role="group" aria-label="翻译服务">
        <button type="button" aria-pressed={!freeTranslation} disabled={switchingProvider}
          onClick={() => { if (freeTranslation) void handleSetFreeTranslation(false); }}>自定义 API</button>
        <button type="button" aria-pressed={freeTranslation} disabled={switchingProvider}
          onClick={() => { if (!freeTranslation) void handleSetFreeTranslation(true); }}>Google 免费翻译</button>
      </div>
      {freeTranslation ? (
        <div className="provider-description">
          <h4>即开即用，无需密钥</h4>
          <p>使用 Google 翻译服务，需要能够连接 Google。</p>
          <p>已有的 API 配置会保留，随时可以切换回来。</p>
        </div>
      ) : <>
      <div className="api-fields">
      <SettingInput
        label="Base URL"
        value={baseUrl}
        onChange={(event) => onBaseUrlChange(event.target.value)}
        onBlur={() => void saveConfig()}
        placeholder="https://api.openai.com"
      />
      <div className="setting-field">
        <label htmlFor="api-key">API Key</label>
        {isLinuxCore() && <p className="setting-hint" role="note">{apiKeyStorage === "secret-service"
          ? "使用系统 Secret Service 保存，不写入配置文件。密钥环可能需要解锁。"
          : "系统密钥环尚未就绪，无法确认持久保存。请启用并解锁 GNOME Keyring 或支持 Secret Service 的 KWallet 后重试；不会写入配置文件。"}</p>}
        <div className="setting-inline">
          <input
            id="api-key"
            type="password"
            value={apiKeyUpdate ?? ""}
            onChange={(event) => onApiKeyChange(event.target.value)}
            onBlur={() => void saveConfig()}
            placeholder={hasStoredApiKey ? (isLinuxCore() && apiKeyStorage !== "secret-service" ? "本次运行可用，持久存储待确认" : "已安全保存，输入新 Key 可替换") : "sk-..."}
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
      </div>
      <div className="connection-test-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void runConnectionTest()}
          disabled={testingConnection}
        >
          {testingConnection ? "测试中..." : "测试连接"}
        </button>
        {connectionResult && (
          <span role="status" className={connectionResult.ok ? "connection-result connection-result--ok" : "connection-result connection-result--error"}>
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
        notifyError={notifyError}
      />
      </>}
    </section>
  );
}
