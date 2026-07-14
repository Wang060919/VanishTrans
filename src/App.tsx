import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ScreenshotOverlay from "./ScreenshotOverlay";
import MainLayout from "./layouts/MainLayout";
import { useTranslation } from "./hooks/useTranslation";
import { useConfig } from "./hooks/useConfig";
import { useTauriEvents } from "./hooks/useTauriEvents";

export default function App() {
  const [isScreenshot, setIsScreenshot] = useState(false);
  const [pinned, setPinned] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const translation = useTranslation();
  const config = useConfig();

  // Detect screenshot window
  useEffect(() => {
    const label = getCurrentWindow().label;
    if (label === "screenshot") setIsScreenshot(true);
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

    onStreamChunk: translation.handleStreamChunk,
    onStreamDone: translation.handleStreamDone,
  });

  // Signal Rust that frontend listeners are mounted
  useEffect(() => {
    if (!isScreenshot) {
      invoke("frontend_ready");
    }
  }, [isScreenshot]);

  const handlePin = useCallback(async () => {
    setPinned(await invoke<boolean>("toggle_pin"));
  }, []);

  const handleTranslate = useCallback(async () => {
    await translation.doTranslateStream(translation.inputText);
  }, [translation.inputText, translation.doTranslateStream]);

  if (isScreenshot) return <ScreenshotOverlay />;

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
