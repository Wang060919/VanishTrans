import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ScreenshotOverlay from "./ScreenshotOverlay";
import BallWindow from "./features/BallWindow";
import MainLayout from "./layouts/MainLayout";
import { useTranslation } from "./hooks/useTranslation";
import { useConfig } from "./hooks/useConfig";
import { useTauriEvents } from "./hooks/useTauriEvents";

export default function App() {
  const [windowType, setWindowType] = useState<"main" | "screenshot" | "ball">("main");
  const [pinned, setPinned] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const translation = useTranslation();
  const config = useConfig();

  // Detect window type
  useEffect(() => {
    const label = getCurrentWindow().label;
    if (label === "screenshot") setWindowType("screenshot");
    else if (label === "ball") setWindowType("ball");
  }, []);

  // Tauri event wiring
  useTauriEvents({
    onClipboardTranslate: useCallback((text: string) => {
      if (text.startsWith("ERROR:")) {
        translation.setOutputText(`❌ ${text.slice(6)}`);
        translation.setLoading(false);
        return;
      }
      translation.doTranslateStream(text);
    }, [translation.doTranslateStream]),

    onOcrTranslate: useCallback((text: string) => {
      translation.setOutputText("");
      translation.setInputText("");
      translation.doTranslateStream(text);
    }, [translation.doTranslateStream]),

    onScreenshotStart: useCallback(() => {
      translation.setOutputText("");
      translation.setInputText("");
    }, []),

    onScreenshotError: useCallback((message: string) => {
      translation.setOutputText(`❌ ${message}`);
      translation.setLoading(false);
    }, []),

    onStreamChunk: translation.handleStreamChunk,
    onStreamDone: translation.handleStreamDone,
  });

  // Signal Rust that the main window listeners are mounted and synchronize pin state.
  useEffect(() => {
    if (getCurrentWindow().label !== "main") return;
    invoke("frontend_ready").catch((e) => console.error("[app] frontend_ready failed:", e));
    invoke<boolean>("get_pin_state")
      .then(setPinned)
      .catch((e) => console.error("[app] get_pin_state failed:", e));
  }, []);

  const handlePin = useCallback(async () => {
    try {
      setPinned(await invoke<boolean>("toggle_pin"));
    } catch (e) {
      console.error("[app] toggle_pin failed:", e);
    }
  }, []);

  const handleTranslate = useCallback(async () => {
    await translation.doTranslateStream(translation.inputText);
  }, [translation.inputText, translation.doTranslateStream]);

  if (windowType === "screenshot") return <ScreenshotOverlay />;
  if (windowType === "ball") return <BallWindow />;

  return (
    <MainLayout
      inputText={translation.inputText}
      onInputChange={translation.setInputText}
      outputText={translation.outputText}
      loading={translation.loading}
      pinned={pinned}
      onPin={handlePin}
      direction={translation.direction}
      onDirectionChange={translation.updateDirection}
      glowActive={translation.glowActive}
      onClearGlow={translation.clearGlow}
      onTranslate={handleTranslate}
      inputRef={inputRef as React.RefObject<HTMLTextAreaElement>}
      baseUrl={config.baseUrl}
      onBaseUrlChange={config.setBaseUrl}
      model={config.model}
      onModelChange={config.setModel}
      hasStoredApiKey={config.hasStoredApiKey}
      apiKeyUpdate={config.apiKeyUpdate}
      onApiKeyChange={config.setApiKeyUpdate}
      onSaveConfig={config.saveConfig}
      glossary={config.glossary}
      onGlossaryChange={config.saveGlossary}
      hotkeys={config.hotkeys}
      hotkeyLabels={config.hotkeyLabels}
      onHotkeysChange={config.saveHotkeys}
      streaming={translation.streaming}
      fileStatus={translation.fileStatus}
      onTranslateFile={translation.doTranslateFile}
      translationKey={translation.translationKey}
    />
  );
}
