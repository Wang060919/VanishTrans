import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { logError } from "../lib/logger";

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface HotkeyEntry {
  action: string;
  shortcut: string;
}

export interface ServiceProfile {
  name: string;
  baseUrl: string;
  model: string;
}

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
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [hotkeys, setHotkeys] = useState<HotkeyEntry[]>(DEFAULT_HOTKEYS);
  const [profiles, setProfiles] = useState<ServiceProfile[]>([]);
  const [loggingEnabled, setLoggingEnabled] = useState(true);

  useEffect(() => {
    invoke<{ baseUrl: string; hasApiKey: boolean; model: string; glossary: [string, string][]; hotkeys: [string, string][]; profiles: ServiceProfile[] }>("get_api_config")
      .then((cfg) => {
        setBaseUrl(cfg.baseUrl);
        setHasStoredApiKey(cfg.hasApiKey);
        setModel(cfg.model);
        setProfiles(cfg.profiles ?? []);
        if (cfg.glossary) {
          setGlossary(cfg.glossary.map(([source, target]) => ({ source, target })));
        }
        if (cfg.hotkeys && cfg.hotkeys.length > 0) {
          setHotkeys(cfg.hotkeys.map(([action, shortcut]) => ({ action, shortcut })));
        }
      })
      .catch((e) => logError("config", "failed to load", e));
    invoke<boolean>("get_logging_enabled")
      .then(setLoggingEnabled)
      .catch((e) => logError("config", "failed to load logging setting", e));
  }, []);

  const saveConfig = async (forcedApiKey?: string) => {
    // Only send apiKey when user actually changed it — avoid overwriting with null
    const apiKey = forcedApiKey === undefined ? apiKeyUpdate : forcedApiKey;
    await invoke("set_api_config", {
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
    await invoke("set_glossary", { glossary: pairs });
    setGlossary(entries);
  };

  const saveHotkeys = async (entries: HotkeyEntry[]) => {
    const pairs: [string, string][] = entries.map((e) => [e.action, e.shortcut]);
    await invoke("set_hotkeys", { hotkeys: pairs });
    setHotkeys(entries);
  };

  const testConnection = async (): Promise<string> => {
    return invoke<string>("test_connection", {
      baseUrl,
      apiKey: apiKeyUpdate !== null && apiKeyUpdate !== undefined ? apiKeyUpdate : undefined,
      model,
    });
  };

  const saveProfile = async (profile: ServiceProfile): Promise<ServiceProfile[]> => {
    const next = await invoke<ServiceProfile[]>("save_service_profile", {
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
    });
    setProfiles(next);
    return next;
  };

  const deleteProfile = async (name: string): Promise<ServiceProfile[]> => {
    const next = await invoke<ServiceProfile[]>("delete_service_profile", { name });
    setProfiles(next);
    return next;
  };

  const applyProfile = async (name: string): Promise<ServiceProfile> => {
    const profile = await invoke<ServiceProfile>("apply_service_profile", { name });
    setBaseUrl(profile.baseUrl);
    setModel(profile.model);
    return profile;
  };

  const setLogging = async (enabled: boolean) => {
    await invoke("set_logging_enabled", { enabled });
    setLoggingEnabled(enabled);
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
    testConnection,
    loggingEnabled, setLogging,
  };
}
