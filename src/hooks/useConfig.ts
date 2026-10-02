import { useEffect, useRef, useState } from "react";
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


  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueWrite = <T,>(operation: () => Promise<T>): Promise<T> => {
    const queued = writeQueueRef.current.catch(() => undefined).then(operation);
    writeQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  };
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
    // Send apiKey only for a real change: the 清除 button forces "", while a
    // blank or whitespace-only edit means "keep the stored key" — otherwise an
    // emptied field would overwrite the credential with an empty string.
    const apiKey = forcedApiKey === undefined
      ? (apiKeyUpdate === null ? undefined : apiKeyUpdate.trim() || undefined)
      : forcedApiKey;
    const request = {
      baseUrl,
      apiKey,
      model,
    };
    await enqueueWrite(() => setApiConfig(request));
    if (apiKey !== undefined) {
      setHasStoredApiKey(apiKey.length > 0);
    }
    if (apiKeyUpdate !== null) setApiKeyUpdate(null);
  };

  const saveGlossary = async (entries: GlossaryEntry[]) => {
    const pairs: [string, string][] = entries.map((e) => [e.source, e.target]);
    await enqueueWrite(() => setGlossary({ glossary: pairs }));
    setGlossaryState(entries);
  };

  const saveHotkeys = async (entries: HotkeyEntry[]) => {
    const pairs: [string, string][] = entries.map((e) => [e.action, e.shortcut]);
    await enqueueWrite(() => setHotkeys({ hotkeys: pairs }));
    setHotkeysState(entries);
  };

  const testConnectionApi = async (): Promise<string> => {
    return testConnection({
      baseUrl,
      apiKey: apiKeyUpdate?.trim() ? apiKeyUpdate.trim() : undefined,
      model,
    });
  };

  const saveProfile = async (profile: ServiceProfile): Promise<ServiceProfile[]> => {
    const next = await enqueueWrite(() => saveServiceProfile({
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
    }));
    setProfiles(next);
    return next;
  };

  const deleteProfile = async (name: string): Promise<ServiceProfile[]> => {
    const next = await enqueueWrite(() => deleteServiceProfile({ name }));
    setProfiles(next);
    return next;
  };

  const applyProfile = async (name: string): Promise<ServiceProfile> => {
    const profile = await enqueueWrite(() => applyServiceProfile({ name }));
    setBaseUrl(profile.baseUrl);
    setModel(profile.model);
    return profile;
  };

  const setLogging = async (enabled: boolean) => {
    await enqueueWrite(() => setLoggingEnabledCmd({ enabled }));
    setLoggingEnabled(enabled);
  };

  const setFreeTranslation = async (enabled: boolean) => {
    await enqueueWrite(() => setFreeTranslationCmd({ enabled }));
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
