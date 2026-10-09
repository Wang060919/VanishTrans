import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect } from "react";
import { useThemeSync } from "../../hooks/useTheme";
import { logInfo } from "../../lib/logger";
import { getForegroundWindowInfo } from "../../services/tauriBridge";
import { type BallState } from "./useBallState";
import { type BallTransitions } from "./useBallTransitions";
import { type BallActions } from "./useBallActions";
import { type BallDrag } from "./useBallDrag";

type BallEventsState = Pick<BallState,
  "mode" | "modeRef" | "draggingRef" | "transitionCoordinator" |
  "coordinatorLifetimeRef" | "expectingTranslationRef" | "expectedActivityTimerRef" | "noticeTimerRef" |
  "statusTimerRef" | "fullPinnedRef" | "phaseRef" | "phase" | "busyActionRef" | "noticeRef" |
  "setPhase" | "commitResult" | "statusErrorRef" | "activityAggregator"
> & Pick<BallTransitions, "transitionMode" | "requestFocusCollapse" | "cancelFocusCollapse">
  & Pick<BallActions, "scheduleStatusCollapse"> & Pick<BallDrag, "clearPointerOrigin">;

export function useBallEvents({
  mode, modeRef, draggingRef, transitionCoordinator, coordinatorLifetimeRef, expectingTranslationRef,
  expectedActivityTimerRef, noticeTimerRef, statusTimerRef, fullPinnedRef, phaseRef, phase, setPhase, commitResult,
  busyActionRef, noticeRef, statusErrorRef, activityAggregator,
  transitionMode, requestFocusCollapse, cancelFocusCollapse, scheduleStatusCollapse, clearPointerOrigin,
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
      const activity = activityAggregator.current.accept(event.payload);
      if (!activity) return;
      logInfo("ball.events", "translation-state", {
        activity, mode: modeRef.current,
        requested: transitionCoordinator.requestedTarget,
      });
      commitResult(activityAggregator.current.completedResult);
      statusErrorRef.current = activityAggregator.current.errorDetail;
      // Only an event from the session the action launched resolves the
      // expectation; cross-source and anonymous events leave it armed.
      if (expectingTranslationRef.current !== null
        && activityAggregator.current.lastAcceptedSourceId?.startsWith(expectingTranslationRef.current)) {
        expectingTranslationRef.current = null;
        if (expectedActivityTimerRef.current) {
          clearTimeout(expectedActivityTimerRef.current);
          expectedActivityTimerRef.current = null;
        }
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
      if (focused) {
        cancelFocusCollapse();
        logInfo("ball.events", "focus changed", { focused, mode: modeRef.current });
        return;
      }
      // The native drag loop can briefly deactivate the window. Do not queue
      // an automatic collapse that would run as soon as dragging ends.
      if (draggingRef.current) return;
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      // Same gate as the DOM blur path: a running action or a visible notice
      // means the island is intentionally open. An in-flight transition only
      // vets the actions branch — a queued full collapse must still supersede
      // a pending expansion so the window doesn't stay half-open.
      const focusCollapseGuarded = busyActionRef.current !== null
        || !!noticeRef.current;
      const shouldCollapseActions = (effectiveMode === "peek" || effectiveMode === "actions")
        && !transitionCoordinator.isTransitioning
        && !focusCollapseGuarded
        && !expectingTranslationRef.current;
      const shouldCollapseFull = !focusCollapseGuarded
        && (effectiveMode === "result"
          || (effectiveMode === "full" && !fullPinnedRef.current));
      // Identify which window holds the foreground right now — the focus
      // thief is already foreground by the time this event lands.
      void getForegroundWindowInfo()
        .then((owner) => logInfo("ball.events", "foreground owner on blur", { owner }))
        .catch(() => {});
      logInfo("ball.events", "focus changed", {
        focused, mode: modeRef.current, effectiveMode,
        collapse: shouldCollapseActions || shouldCollapseFull,
      });
      if (shouldCollapseActions || shouldCollapseFull) requestFocusCollapse();
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
      if (modeRef.current === "peek" || modeRef.current === "actions" || modeRef.current === "full" || modeRef.current === "result") {
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
      cancelFocusCollapse();
    };
  }, [
    clearPointerOrigin, transitionCoordinator, transitionMode, modeRef, draggingRef, expectingTranslationRef,
    expectedActivityTimerRef, clearNoticeTimer, statusTimerRef, fullPinnedRef, phaseRef, setPhase, commitResult,
    busyActionRef, noticeRef, statusErrorRef, activityAggregator, requestFocusCollapse, cancelFocusCollapse,
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
