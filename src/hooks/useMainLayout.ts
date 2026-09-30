import { startScreenshotFromBall, startWindowDragging, hideWindow, deleteHistoryRecord, clearHistory, getHistory } from "../services/tauriBridge";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useTheme } from "./useTheme";
import { logError } from "../lib/logger";
import type { TranslationRecord } from "../types";
import type { MainLayoutShellProps } from "../layouts/MainLayout.types";
type ActivePanel = "settings" | "history" | null;

/** Window and history operations are independent of visual navigation. */
export function useMainLayout(shell: MainLayoutShellProps = {}) {
  const { embedded = false, onCollapse, onScreenshot, onWindowDragStart, onWindowDragEnd, onWindowMoved } = shell;
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [historyRecords, setHistoryRecords] = useState<TranslationRecord[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRequestRef = useRef(0);
  useTheme();

  const loadHistory = useCallback(async (query?: string) => {
    const request = ++historyRequestRef.current;
    try {
      const records = await getHistory({ query });
      if (request === historyRequestRef.current) setHistoryRecords(records ?? []);
    } catch (error: unknown) {
      if (request === historyRequestRef.current) {
        setHistoryRecords([]);
        logError("history", "load history failed", error);
      }
    }
  }, []);
  const openHistory = useCallback(async () => {
    if (activePanel === "history") {
      setActivePanel(null);
      return;
    }
    await loadHistory(historySearch || undefined);
    setActivePanel("history");
  }, [activePanel, historySearch, loadHistory]);

  const openSettings = useCallback(() => {
    setActivePanel((current) => current === "settings" ? null : "settings");
  }, []);

  const startScreenshot = useCallback(async () => {
    try {
      if (onScreenshot) await onScreenshot();
      else await startScreenshotFromBall();
    } catch (error) {
      logError("main", "start screenshot translation failed", error);
    }
  }, [onScreenshot]);

  const handleHistorySearch = useCallback((query: string) => {
    setHistorySearch(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadHistory(query || undefined), 200);
  }, [loadHistory]);


  const handleHistoryDelete = useCallback(async (id: number) => {
    try {
      await deleteHistoryRecord({ id });
      await loadHistory(historySearch || undefined);
    } catch (error: unknown) {
      logError("history", "delete history record failed", error);
    }
  }, [historySearch, loadHistory]);

  const handleHistoryClear = useCallback(async () => {
    try {
      await clearHistory();
      await loadHistory();
    } catch (error: unknown) {
      logError("history", "clear history failed", error);
    }
  }, [loadHistory]);
  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    if (embedded) {
      await onCollapse?.();
      return;
    }
    try { await getCurrentWindow().minimize(); } catch (e) { logError("main.window", "minimize failed", e); }
  }, [embedded, onCollapse]);
  const handleMaximize = useCallback(async () => {
    try { await getCurrentWindow().toggleMaximize(); } catch (e) { logError("main.window", "maximize failed", e); }
  }, []);
  const handleClose = useCallback(async () => {
    try { await hideWindow(); } catch (e) { logError("main.window", "hide failed", e); }
  }, []);

  // Position updates must wait for native dragging to finish, not just start.
  const handleHeaderMouseDown = useCallback(async (e: MouseEvent) => {
    if (e.button !== 0
      || (e.target as HTMLElement).closest("button, .window-controls, select, input, a")) return;
    if (onWindowDragStart?.() === false) return;
    try {
      const moved = await startWindowDragging();
      if (moved) await onWindowMoved?.();
    } catch {
      // Native dragging can be unavailable in a browser-only preview.
    } finally {
      onWindowDragEnd?.();
    }
  }, [onWindowDragEnd, onWindowDragStart, onWindowMoved]);

  return { activePanel, setActivePanel, historyRecords, historySearch, openHistory, openSettings,
    startScreenshot, handleHistorySearch, handleHistoryDelete, handleHistoryClear,
    handleMinimize, handleMaximize, handleClose, handleHeaderMouseDown };
}
