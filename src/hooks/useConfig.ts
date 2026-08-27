import { useEffect, useState } from "react";
import {
  applyServiceProfile,
  deleteServiceProfile,
  getApiConfig,
  getLoggingEnabled,
  saveServiceProfile,
  setApiConfig,
  setFreeTranslation as setFreeTranslationCmd,
  setGlossary,
  setHotkeys,
  setLoggingEnabled as setLoggingEnabledCmd,
  testConnection,
} from "../services/tauriBridge";
import type { GlossaryEntry, HotkeyEntry, ServiceProfile } from "../types";
import { logError } from "../lib/logger";

const DEFAULT_HOTKEYS: HotkeyEntry[] = [
  { action: "translate", shortcut: "Alt+Q" },
  { action: "replace", shortcut: "Alt+R" },
  { action: "screenshot", shortcut: "Alt+W" },
];

const HOTKEY_LABELS: Record<string, string> = {
  translate: "划词翻译",
  replace: "原地替换",
  screenshot: "截图 OCR",
};

export function useConfig() {
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [model, setModel] = useState("gpt-4o-mini");
  const [apiKeyUpdate, setApiKeyUpdate] = useState<string | null>(null);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [glossary, setGlossaryState] = useState<GlossaryEntry[]>([]);
  const [hotkeys, setHotkeysState] = useState<HotkeyEntry[]>(DEFAULT_HOTKEYS);
  const [profiles, setProfiles] = useState<ServiceProfile[]>([]);
  const [loggingEnabled, setLoggingEnabled] = useState(true);
  const [freeTranslation, setFreeTranslationState] = useState(false);

  useEffect(() => {
    getApiConfig()
      .then((cfg) => {
        setBaseUrl(cfg.baseUrl);
        setHasStoredApiKey(cfg.hasApiKey);
        setModel(cfg.model);
        setProfiles(cfg.profiles ?? []);
        setFreeTranslationState(cfg.freeTranslation ?? false);
        if (cfg.glossary) {
          setGlossaryState(cfg.glossary.map(([source, target]) => ({ source, target })));
        }
        if (cfg.hotkeys && cfg.hotkeys.length > 0) {
          setHotkeysState(cfg.hotkeys.map(([action, shortcut]) => ({ action, shortcut })));
        }
      })
      .catch((e) => logError("config", "failed to load", e));
    getLoggingEnabled()
      .then(setLoggingEnabled)
      .catch((e) => logError("config", "failed to load logging setting", e));
  }, []);

  const saveConfig = async (forcedApiKey?: string) => {
    // Only send apiKey when user actually changed it — avoid overwriting with null
    const apiKey = forcedApiKey === undefined ? apiKeyUpdate : forcedApiKey;
    await setApiConfig({
      baseUrl,
      apiKey: apiKey !== null ? apiKey : undefined,
      model,
    });
    if (apiKey !== null) {
      setHasStoredApiKey(apiKey.length > 0);
      setApiKeyUpdate(null);
    }
  };

  const saveGlossary = async (entries: GlossaryEntry[]) => {
    const pairs: [string, string][] = entries.map((e) => [e.source, e.target]);
    await setGlossary({ glossary: pairs });
    setGlossaryState(entries);
  };

  const saveHotkeys = async (entries: HotkeyEntry[]) => {
    const pairs: [string, string][] = entries.map((e) => [e.action, e.shortcut]);
    await setHotkeys({ hotkeys: pairs });
    setHotkeysState(entries);
  };

  const testConnectionApi = async (): Promise<string> => {
    return testConnection({
      baseUrl,
      apiKey: apiKeyUpdate !== null && apiKeyUpdate !== undefined ? apiKeyUpdate : undefined,
      model,
    });
  };

  const saveProfile = async (profile: ServiceProfile): Promise<ServiceProfile[]> => {
    const next = await saveServiceProfile({
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
    });
    setProfiles(next);
    return next;
  };

  const deleteProfile = async (name: string): Promise<ServiceProfile[]> => {
    const next = await deleteServiceProfile({ name });
    setProfiles(next);
    return next;
  };

  const applyProfile = async (name: string): Promise<ServiceProfile> => {
    const profile = await applyServiceProfile({ name });
    setBaseUrl(profile.baseUrl);
    setModel(profile.model);
    return profile;
  };

  const setLogging = async (enabled: boolean) => {
    await setLoggingEnabledCmd({ enabled });
    setLoggingEnabled(enabled);
  };

  const setFreeTranslation = async (enabled: boolean) => {
    await setFreeTranslationCmd({ enabled });
    setFreeTranslationState(enabled);
  };

  return {
    baseUrl, setBaseUrl,
    model, setModel,
    apiKeyUpdate, setApiKeyUpdate,
    hasStoredApiKey,
    saveConfig,
    glossary, saveGlossary,
    hotkeys, saveHotkeys,
    hotkeyLabels: HOTKEY_LABELS,
    profiles, saveProfile, deleteProfile, applyProfile,
    testConnection: testConnectionApi,
    loggingEnabled, setLogging,
    freeTranslation, setFreeTranslation,
  };
}
