import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface HotkeyEntry {
  action: string;
  shortcut: string;
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

  useEffect(() => {
    invoke<{ baseUrl: string; hasApiKey: boolean; model: string; glossary: [string, string][]; hotkeys: [string, string][] }>("get_api_config")
      .then((cfg) => {
        setBaseUrl(cfg.baseUrl);
        setHasStoredApiKey(cfg.hasApiKey);
        setModel(cfg.model);
        if (cfg.glossary) {
          setGlossary(cfg.glossary.map(([source, target]) => ({ source, target })));
        }
        if (cfg.hotkeys && cfg.hotkeys.length > 0) {
          setHotkeys(cfg.hotkeys.map(([action, shortcut]) => ({ action, shortcut })));
        }
      })
      .catch((e) => console.error("[config] Failed to load:", e));
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
    setGlossary(entries);
    const pairs: [string, string][] = entries.map((e) => [e.source, e.target]);
    await invoke("set_glossary", { glossary: pairs });
  };

  const saveHotkeys = async (entries: HotkeyEntry[]) => {
    setHotkeys(entries);
    const pairs: [string, string][] = entries.map((e) => [e.action, e.shortcut]);
    await invoke("set_hotkeys", { hotkeys: pairs });
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
  };
}
