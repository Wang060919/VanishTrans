import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type IslandMode, type IslandMotion } from "../islandModel";
import {
  type IslandTransitionContext, type IslandTransitionReason, type IslandTransitionRequest,
} from "../islandTransitionCoordinator";
import { getForegroundWindowInfo } from "../../services/tauriBridge";
import { logInfo } from "../../lib/logger";
import { runBallTransition } from "./ballTransition";
import { type BallState } from "./useBallState";

export interface TransitionOptions {
  motion?: IslandMotion;
  reason?: IslandTransitionReason;
}

/** Blur must persist this long before the island collapses — absorbs focus
 * arbitration churn (ForegroundStaging) and click-through transient blurs.
 * 220ms sits just under the shortest steal we logged (~270ms overlay grabs);
 * lower values would collapse during a steal that still returns focus. */
const FOCUS_COLLAPSE_DELAY_MS = 220;
const FOCUS_COLLAPSE_RECHECK_MS = 180;
/** Shell pseudo-windows that hold foreground while Windows arbitrates focus —
 * they resolve to a real window (or back to us) within a few hundred ms. */
const STAGING_OWNER = /ForegroundStaging|Shell_.*TrayWnd|Progman/;

type BallTransitionsState = Pick<BallState,
  "modeRef" | "nativeModeRef" | "nativeTargetModeRef" | "presentationRef" |
  "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef" | "noticeRef" |
  "commitPresentation" | "setDockSide" | "setNotice" | "shouldReduceMotion" |
  "transitionCoordinator" | "statusTimerRef" | "expectingTranslationRef" |
  "fullPinnedRef" | "focusCollapseTimerRef" | "transitionSettledAtRef"
>;

export function useBallTransitions({
  modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
  idleOuterSizeRef, noticeRef, commitPresentation, setDockSide, setNotice, shouldReduceMotion,
  transitionCoordinator, statusTimerRef, expectingTranslationRef, fullPinnedRef,
  focusCollapseTimerRef, transitionSettledAtRef,
}: BallTransitionsState) {
  const runTransition = useCallback((request: IslandTransitionRequest, context: IslandTransitionContext) =>
    runBallTransition({
      modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
      idleOuterSizeRef, noticeRef, commitPresentation, setDockSide, setNotice, transitionCoordinator,
    }, request, context), [
    modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
    idleOuterSizeRef, noticeRef, commitPresentation, setDockSide, setNotice, transitionCoordinator,
  ]);
  const transitionMode = useCallback((
    target: IslandMode,
    options: TransitionOptions = {},
  ) => {
    if ((target === "full" || target === "result") && statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    const request: IslandTransitionRequest = {
      target,
      motion: shouldReduceMotion ? "instant" : options.motion ?? "animated",
      reason: options.reason ?? "user",
    };
    const task = transitionCoordinator.request(request, runTransition);
    void task.finally(() => {
      transitionSettledAtRef.current = performance.now();
    });
    return task;
  }, [runTransition, shouldReduceMotion, transitionCoordinator, statusTimerRef, transitionSettledAtRef]);

  const cancelFocusCollapse = useCallback(() => {
    if (focusCollapseTimerRef.current) {
      clearTimeout(focusCollapseTimerRef.current);
      focusCollapseTimerRef.current = null;
    }
  }, [focusCollapseTimerRef]);

  const requestFocusCollapse = useCallback((motion: IslandMotion = "animated") => {
    cancelFocusCollapse();
    let rechecked = false;
    const settle = async () => {
      focusCollapseTimerRef.current = null;
      let focused = false;
      try {
        focused = await getCurrentWindow().isFocused();
      } catch { /* treat IPC failure as unfocused */ }
      if (focused) return;
      if (!rechecked) {
        rechecked = true;
        try {
          const owner = await getForegroundWindowInfo();
          logInfo("ball.events", "focus collapse check", { owner });
          if (owner && STAGING_OWNER.test(owner)) {
            // Arbitration in flight — where focus lands is undecided yet.
            focusCollapseTimerRef.current = setTimeout(() => void settle(), FOCUS_COLLAPSE_RECHECK_MS);
            return;
          }
        } catch { /* fall through to collapse */ }
      }
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      const collapseActions = (effectiveMode === "peek" || effectiveMode === "actions")
        && !expectingTranslationRef.current;
      const collapseFull = effectiveMode === "result"
        || (effectiveMode === "full" && !fullPinnedRef.current);
      if (collapseActions || collapseFull) void transitionMode("idle", { motion, reason: "focus-loss" });
    };
    focusCollapseTimerRef.current = setTimeout(() => void settle(), FOCUS_COLLAPSE_DELAY_MS);
  }, [
    cancelFocusCollapse, transitionCoordinator, transitionMode, modeRef,
    expectingTranslationRef, fullPinnedRef, focusCollapseTimerRef,
  ]);

  return { transitionMode, requestFocusCollapse, cancelFocusCollapse };
}
export type BallTransitions = ReturnType<typeof useBallTransitions>;
