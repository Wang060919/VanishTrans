import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect } from "react";
import { useThemeSync } from "../../hooks/useTheme";
import { normalizeTranslationActivity } from "./ballActivity";
import { type BallState } from "./useBallState";
import { type BallTransitions } from "./useBallTransitions";
import { type BallActions } from "./useBallActions";
import { type BallDrag } from "./useBallDrag";

type BallEventsState = Pick<BallState,
  "mode" | "modeRef" | "draggingRef" | "transitionCoordinator" |
  "coordinatorLifetimeRef" | "expectingTranslationRef" | "expectedActivityTimerRef" | "noticeTimerRef" |
  "statusTimerRef" | "fullPinnedRef" | "phaseRef" | "phase" |
  "setPhase"
> & Pick<BallTransitions, "transitionMode"> & Pick<BallActions, "scheduleStatusCollapse"> & Pick<BallDrag, "clearPointerOrigin">;

export function useBallEvents({
  mode, modeRef, draggingRef, transitionCoordinator, coordinatorLifetimeRef, expectingTranslationRef,
  expectedActivityTimerRef, noticeTimerRef, statusTimerRef, fullPinnedRef, phaseRef, phase, setPhase,
  transitionMode, scheduleStatusCollapse, clearPointerOrigin,
}: BallEventsState) {
  const clearNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, [noticeTimerRef]);
  useThemeSync();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!document.documentElement.dataset.theme) {
        const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
      }
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.body.classList.add("ball-window-body");
    return () => document.body.classList.remove("ball-window-body");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("ball-window-body--full", mode === "full");
    return () => document.body.classList.remove("ball-window-body--full");
  }, [mode]);

  useEffect(() => {
    if (mode !== "status" || phase === "working" || draggingRef.current) return;
    scheduleStatusCollapse(phase);

    return () => {
      if (!statusTimerRef.current) return;
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    };
  }, [mode, phase, scheduleStatusCollapse, draggingRef, statusTimerRef]);

  useEffect(() => {
    const translationListener = listen<unknown>("translation-state", (event) => {
      const activity = normalizeTranslationActivity(event.payload);
      if (!activity) return;
      expectingTranslationRef.current = false;
      if (expectedActivityTimerRef.current) {
        clearTimeout(expectedActivityTimerRef.current);
        expectedActivityTimerRef.current = null;
      }
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }

      const fullIsActiveOrPending = modeRef.current === "full"
        || transitionCoordinator.requestedTarget === "full";
      if (fullIsActiveOrPending) {
        phaseRef.current = activity;
        setPhase(activity);
        return;
      }

      if (activity === "idle") {
        void transitionMode("idle", { reason: "business" });
        return;
      }

      phaseRef.current = activity;
      setPhase(activity);
      void transitionMode("status", { reason: "business" });
    });
    const focusListener = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      const shouldCollapseActions = (effectiveMode === "peek" || effectiveMode === "actions")
        && !expectingTranslationRef.current;
      const shouldCollapseFull = effectiveMode === "full"
        && !fullPinnedRef.current;
      if (!focused && shouldCollapseActions) {
        void transitionMode("idle", { reason: "focus-loss" });
      } else if (!focused && shouldCollapseFull) {
        void transitionMode("idle", { reason: "focus-loss" });
      }
    });
    const expandListener = listen("expand-main-window", () => {
      void transitionMode("full", { reason: "user" });
    });
    const toggleMainListener = listen("toggle-main-window", () => {
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      void transitionMode(effectiveMode === "full" ? "idle" : "full", { reason: "user" });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      if (modeRef.current === "peek" || modeRef.current === "actions" || modeRef.current === "full") {
        void transitionMode("idle", { reason: "keyboard" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", clearPointerOrigin);
    window.addEventListener("pointercancel", clearPointerOrigin);
    window.addEventListener("blur", clearPointerOrigin);

    return () => {
      void translationListener.then((unlisten) => unlisten()).catch(() => { });
      void focusListener.then((unlisten) => unlisten()).catch(() => { });
      void expandListener.then((unlisten) => unlisten()).catch(() => { });
      void toggleMainListener.then((unlisten) => unlisten()).catch(() => { });
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", clearPointerOrigin);
      window.removeEventListener("pointercancel", clearPointerOrigin);
      window.removeEventListener("blur", clearPointerOrigin);
      if (expectedActivityTimerRef.current) clearTimeout(expectedActivityTimerRef.current);
      clearNoticeTimer();
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [
    clearPointerOrigin, transitionCoordinator, transitionMode, modeRef, expectingTranslationRef,
    expectedActivityTimerRef, clearNoticeTimer, statusTimerRef, fullPinnedRef, phaseRef, setPhase,
  ]);

  useEffect(() => {
    const lifetime = ++coordinatorLifetimeRef.current;
    return () => {
      queueMicrotask(() => {
        // Read the counter fresh: a StrictMode remount bumps it synchronously,
        // so a stale cleanup must NOT dispose the shared coordinator.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (coordinatorLifetimeRef.current === lifetime) {
          transitionCoordinator.dispose();
        }
      });
    };
  }, [transitionCoordinator, coordinatorLifetimeRef]);

  return {};
}
export type BallEvents = ReturnType<typeof useBallEvents>;
