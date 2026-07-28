import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "../hooks/useConfig";
import { useTauriEvents } from "../hooks/useTauriEvents";
import { useTranslation } from "../hooks/useTranslation";
import MainLayout from "../layouts/MainLayout";

interface MainWindowAppProps {
  embedded?: boolean;
  onCollapse?: () => void | Promise<void>;
  onRequestExpand?: () => void | Promise<void>;
  onWindowMoved?: () => void | Promise<void>;
  onPinChange?: (pinned: boolean) => void;
}

export default function MainWindowApp({
  embedded = false,
  onCollapse,
  onRequestExpand,
  onWindowMoved,
  onPinChange,
}: MainWindowAppProps) {
  const [pinned, setPinned] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const translation = useTranslation();
  const config = useConfig();

  const requestExpand = useCallback(() => {
    void onRequestExpand?.();
  }, [onRequestExpand]);

  useTauriEvents({
    onClipboardTranslate: useCallback((text: string) => {
      requestExpand();
      if (text.startsWith("ERROR:")) {
        translation.setOutputText(`❌ ${text.slice(6)}`);
        translation.setLoading(false);
        return;
      }
      translation.doTranslateStream(text);
    }, [requestExpand, translation.doTranslateStream]),

    onOcrTranslate: useCallback((text: string) => {
      requestExpand();
      translation.setOutputText("");
      translation.setInputText("");
      translation.doTranslateStream(text);
    }, [requestExpand, translation.doTranslateStream]),

    onScreenshotStart: useCallback(() => {
      translation.setOutputText("");
      translation.setInputText("");
    }, []),

    onScreenshotError: useCallback((message: string) => {
      requestExpand();
      translation.setOutputText(`❌ ${message}`);
      translation.setLoading(false);
    }, [requestExpand]),

    onStreamChunk: translation.handleStreamChunk,
    onStreamDone: translation.handleStreamDone,
  });

  useEffect(() => {
    const label = getCurrentWindow().label;
    if (label !== "main" && label !== "ball") return;

    invoke("frontend_ready").catch((error) => {
      console.error("[app] frontend_ready failed:", error);
    });
    invoke<boolean>("get_pin_state")
      .then((nextPinned) => {
        if (typeof nextPinned !== "boolean") return;
        setPinned(nextPinned);
        onPinChange?.(nextPinned);
      })
      .catch((error) => console.error("[app] get_pin_state failed:", error));
  }, [onPinChange]);

  useEffect(() => {
    const listener = listen<boolean>("pin-state-changed", (event) => {
      setPinned(event.payload);
      onPinChange?.(event.payload);
    });
    return () => {
      listener.then((unlisten) => unlisten());
    };
  }, [onPinChange]);

  const handlePin = useCallback(async () => {
    try {
      const nextPinned = await invoke<boolean>("toggle_pin");
      setPinned(nextPinned);
      onPinChange?.(nextPinned);
    } catch (error) {
      console.error("[app] toggle_pin failed:", error);
    }
  }, [onPinChange]);

  const handleTranslate = useCallback(async () => {
    await translation.doTranslateStream(translation.inputText);
  }, [translation.inputText, translation.doTranslateStream]);

  return (
    <MainLayout
      embedded={embedded}
      onCollapse={onCollapse}
      onWindowMoved={onWindowMoved}
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
