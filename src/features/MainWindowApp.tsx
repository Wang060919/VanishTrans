import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "../hooks/useConfig";
import { useTauriEvents, type TranslationRequestEvent } from "../hooks/useTauriEvents";
import { useTranslation } from "../hooks/useTranslation";
import MainLayout from "../layouts/MainLayout";
import { logError } from "../lib/logger";

interface MainWindowAppProps {
  embedded?: boolean;
  onCollapse?: () => void | Promise<void>;
  onRequestExpand?: () => void | Promise<void>;
  onWindowDragStart?: () => boolean | void;
  onWindowDragEnd?: () => void;
  onWindowMoved?: () => void | Promise<void>;
  onPinChange?: (pinned: boolean) => void;
}

export default function MainWindowApp({
  embedded = false,
  onCollapse,
  onRequestExpand,
  onWindowDragStart,
  onWindowDragEnd,
  onWindowMoved,
  onPinChange,
}: MainWindowAppProps) {
  const [pinned, setPinned] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const translation = useTranslation();
  const config = useConfig();

  const requestExpand = useCallback(() => {
    void onRequestExpand?.();
  }, [onRequestExpand]);

  const addNotices = useCallback((messages: string[]) => {
    setNotices((current) => Array.from(new Set([...current, ...messages.filter(Boolean)])));
  }, []);

  const doTranslateStreamRef = useRef(translation.doTranslateStream);
  const setOutputTextRef = useRef(translation.setOutputText);
  const setInputTextRef = useRef(translation.setInputText);
  const setLoadingRef = useRef(translation.setLoading);
  const setTranslationErrorRef = useRef(translation.setTranslationError);

  // Keep refs in sync
  useEffect(() => {
    doTranslateStreamRef.current = translation.doTranslateStream;
    setOutputTextRef.current = translation.setOutputText;
    setInputTextRef.current = translation.setInputText;
    setLoadingRef.current = translation.setLoading;
    setTranslationErrorRef.current = translation.setTranslationError;
  }, [translation.doTranslateStream, translation.setOutputText, translation.setInputText, translation.setLoading, translation.setTranslationError]);

  useTauriEvents({
    onClipboardTranslate: useCallback((request: TranslationRequestEvent) => {
      requestExpand();
      if (request.type === "error") {
        setOutputTextRef.current("");
        setTranslationErrorRef.current(request.message);
        setLoadingRef.current(false);
        return;
      }
      doTranslateStreamRef.current(request.text);
    }, [requestExpand]),

    onOcrTranslate: useCallback((text: string) => {
      requestExpand();
      setOutputTextRef.current("");
      setInputTextRef.current("");
      setTranslationErrorRef.current(null);
      doTranslateStreamRef.current(text);
    }, [requestExpand]),

    onScreenshotStart: useCallback(() => {
      setOutputTextRef.current("");
      setInputTextRef.current("");
      setTranslationErrorRef.current(null);
    }, []),

    onScreenshotError: useCallback((message: string) => {
      requestExpand();
      setOutputTextRef.current("");
      setTranslationErrorRef.current(message);
      setLoadingRef.current(false);
    }, [requestExpand]),

    onShortcutConflicts: useCallback((conflicts) => {
      addNotices(conflicts.map((conflict) => conflict.shortcut
        ? `快捷键 ${conflict.shortcut} 注册失败，${conflict.action} 功能已暂时禁用。`
        : `快捷键配置无效：${conflict.error}`));
    }, [addNotices]),

    onStreamChunk: translation.handleStreamChunk,
    onStreamDone: translation.handleStreamDone,
  });

  useEffect(() => {
    const label = getCurrentWindow().label;
    if (label !== "main" && label !== "ball") return;

    void (async () => {
      try {
        await invoke("frontend_ready");
        const warnings = await invoke<string[]>("get_startup_warnings");
        addNotices(warnings ?? []);
      } catch (error) {
        logError("app", "frontend initialization failed", error);
      }
    })();
    invoke<boolean>("get_pin_state")
      .then((nextPinned) => {
        if (typeof nextPinned !== "boolean") return;
        setPinned(nextPinned);
        onPinChange?.(nextPinned);
      })
      .catch((error) => logError("app", "get_pin_state failed", error));
  }, [addNotices, onPinChange]);

  useEffect(() => {
    const listener = listen<boolean>("pin-state-changed", (event) => {
      setPinned(event.payload);
      onPinChange?.(event.payload);
    });
    return () => {
      listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [onPinChange]);

  const handlePin = useCallback(async () => {
    try {
      const nextPinned = await invoke<boolean>("toggle_pin");
      setPinned(nextPinned);
      onPinChange?.(nextPinned);
    } catch (error) {
      logError("app", "toggle_pin failed", error);
    }
  }, [onPinChange]);

  const handleTranslate = useCallback(async (forceRefresh = false) => {
    if (translation.loading) return;
    await translation.doTranslateStream(translation.inputText, forceRefresh);
  }, [translation]);

  return (
    <MainLayout
      embedded={embedded}
      notices={notices}
      onDismissNotice={(message) => setNotices((current) => current.filter((item) => item !== message))}
      onCollapse={onCollapse}
      onWindowDragStart={onWindowDragStart}
      onWindowDragEnd={onWindowDragEnd}
      onWindowMoved={onWindowMoved}
      inputText={translation.inputText}
      onInputChange={translation.setInputText}
      outputText={translation.outputText}
      translationError={translation.translationError}
      loading={translation.loading}
      pinned={pinned}
      onPin={handlePin}
      direction={translation.direction}
      onDirectionChange={translation.updateDirection}
      glowActive={translation.glowActive}
      onClearGlow={translation.clearGlow}
      onTranslate={handleTranslate}
      onCancelTranslation={translation.cancelTranslation}
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
      profiles={config.profiles}
      onSaveProfile={config.saveProfile}
      onDeleteProfile={config.deleteProfile}
      onApplyProfile={config.applyProfile}
      onTestConnection={config.testConnection}
      loggingEnabled={config.loggingEnabled}
      onSetLogging={config.setLogging}
      streaming={translation.streaming}
      fileStatus={translation.fileStatus}
      onTranslateFile={translation.doTranslateFile}
      translationKey={translation.translationKey}
    />
  );
}
