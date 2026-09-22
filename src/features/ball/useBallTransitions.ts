import { useCallback } from "react";
import { type IslandMode, type IslandMotion } from "../islandModel";
import {
  type IslandTransitionContext, type IslandTransitionReason, type IslandTransitionRequest,
} from "../islandTransitionCoordinator";
import { runBallTransition } from "./ballTransition";
import { type BallState } from "./useBallState";

export interface TransitionOptions {
  motion?: IslandMotion;
  reason?: IslandTransitionReason;
}

type BallTransitionsState = Pick<BallState,
  "modeRef" | "nativeModeRef" | "nativeTargetModeRef" | "presentationRef" |
  "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef" | "noticeRef" |
  "commitPresentation" | "setDockSide" | "setNotice" | "shouldReduceMotion" |
  "transitionCoordinator" | "statusTimerRef"
>;

export function useBallTransitions({
  modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
  idleOuterSizeRef, noticeRef, commitPresentation, setDockSide, setNotice, shouldReduceMotion,
  transitionCoordinator, statusTimerRef,
}: BallTransitionsState) {
  const runTransition = useCallback((request: IslandTransitionRequest, context: IslandTransitionContext) =>
    runBallTransition({
      modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
      idleOuterSizeRef, noticeRef, commitPresentation, setDockSide, setNotice,
    }, request, context), [
    modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef, anchorPositionRef,
    idleOuterSizeRef, noticeRef, commitPresentation, setDockSide, setNotice,
  ]);
  const transitionMode = useCallback((
    target: IslandMode,
    options: TransitionOptions = {},
  ) => {
    if (target === "full" && statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    const request: IslandTransitionRequest = {
      target,
      motion: shouldReduceMotion ? "instant" : options.motion ?? "animated",
      reason: options.reason ?? "user",
    };
    return transitionCoordinator.request(request, runTransition);
  }, [runTransition, shouldReduceMotion, transitionCoordinator, statusTimerRef]);

  return { transitionMode };
}
export type BallTransitions = ReturnType<typeof useBallTransitions>;
