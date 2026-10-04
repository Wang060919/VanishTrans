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
  "dockedEdgesRef" |
  "commitPresentation" | "setDockSide" | "setNotice" | "shouldReduceMotion" |
  "transitionCoordinator" | "statusTimerRef" | "expectingTranslationRef" |
  "fullPinnedRef" | "focusCollapseTimerRef" | "transitionSettledAtRef" |
  "busyActionRef" | "draggingRef"
>;

export function useBallTransitions({
  modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
  idleOuterSizeRef, noticeRef, dockedEdgesRef, commitPresentation, setDockSide, setNotice,
  shouldReduceMotion,
  transitionCoordinator, statusTimerRef, expectingTranslationRef, fullPinnedRef,
  focusCollapseTimerRef, transitionSettledAtRef, busyActionRef, draggingRef,
}: BallTransitionsState) {
  const runTransition = useCallback((request: IslandTransitionRequest, context: IslandTransitionContext) =>
    // The settle timestamp is the click guard's reference: stamp it only for
    // tasks the coordinator actually ran — a pending task displaced before
    // draining resolves without touching the native surface.
    runBallTransition({
      modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
      idleOuterSizeRef, noticeRef, dockedEdgesRef,
      commitPresentation, setDockSide, setNotice, transitionCoordinator,
    }, request, context).finally(() => {
      transitionSettledAtRef.current = performance.now();
    }), [
    modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
    idleOuterSizeRef, noticeRef, dockedEdgesRef,
    commitPresentation, setDockSide, setNotice, transitionCoordinator,
    transitionSettledAtRef,
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
    return task;
  }, [runTransition, shouldReduceMotion, transitionCoordinator, statusTimerRef]);

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
      // Re-check the DOM-blur gate at decision time: the blur was 220ms ago,
      // so a running action, a notice or an active drag that appeared
      // meanwhile must veto the collapse the same way the DOM handler would.
      // An in-flight transition only vets the actions branch — a queued full
      // collapse must still supersede a pending expansion.
      const focusCollapseGuarded = busyActionRef.current !== null
        || !!noticeRef.current
        || draggingRef.current;
      const collapseActions = (effectiveMode === "peek" || effectiveMode === "actions")
        && !transitionCoordinator.isTransitioning
        && !focusCollapseGuarded
        && !expectingTranslationRef.current;
      const collapseFull = !focusCollapseGuarded
        && (effectiveMode === "result"
          || (effectiveMode === "full" && !fullPinnedRef.current));
      if (collapseActions || collapseFull) void transitionMode("idle", { motion, reason: "focus-loss" });
    };
    focusCollapseTimerRef.current = setTimeout(() => void settle(), FOCUS_COLLAPSE_DELAY_MS);
  }, [
    cancelFocusCollapse, transitionCoordinator, transitionMode, modeRef,
    expectingTranslationRef, fullPinnedRef, focusCollapseTimerRef, busyActionRef, noticeRef, draggingRef,
  ]);

  return { transitionMode, requestFocusCollapse, cancelFocusCollapse };
}
export type BallTransitions = ReturnType<typeof useBallTransitions>;
