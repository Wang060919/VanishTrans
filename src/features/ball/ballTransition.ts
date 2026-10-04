import { getCurrentWindow } from "@tauri-apps/api/window";
import { logError, logInfo } from "../../lib/logger";
import {
  getIdleAnchorX, getIslandSurfaceMs, hasSameGeometry, ISLAND_TIMING, shrinksIsland,
} from "../islandModel";
import {
  isIslandTransitionAborted, waitForIslandTransition, type IslandTransitionContext,
  type IslandTransitionRequest,
} from "../islandTransitionCoordinator";
import { measureExpandedBounds, paddedTargetCanvas } from "./ballGeometry";
import { clipExpandedSurface, clipExpandedSurfaceDetached } from "./ballSurfaceClip";
import { collapseBallWindow } from "./ballCollapse";
import { rollbackIslandToIdle } from "./ballRollback";
import { setBallWindowBounds } from "./ballNative";
import { type BallState } from "./useBallState";

type BallTransitionState = Pick<BallState,
  "modeRef" | "nativeModeRef" | "nativeTargetModeRef" | "presentationRef" |
  "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef" | "noticeRef" |
  "dockedEdgesRef" |
  "commitPresentation" | "setDockSide" | "setNotice" | "transitionCoordinator"
>;

export async function runBallTransition(state: BallTransitionState, request: IslandTransitionRequest, context: IslandTransitionContext) {
  const {
    modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, anchorPositionRef, commitPresentation,
    transitionCoordinator, dockedEdgesRef,
  } = state;
  const { target, motion } = request;
  const win = getCurrentWindow();
  const previousMode = modeRef.current;
  let stage = "entry";
  logInfo("ball.transition", "begin", {
    from: previousMode, to: target, motion, reason: request.reason,
    native: nativeModeRef.current, nativeTarget: nativeTargetModeRef.current,
  });
  try {
    if (previousMode === target
      && hasSameGeometry(nativeModeRef.current, target)
      && hasSameGeometry(nativeTargetModeRef.current, target)) {
      if (presentationRef.current.phase !== "stable"
        || presentationRef.current.motion !== motion) {
        commitPresentation({
          mode: target,
          motion,
          phase: "stable",
          generation: context.generation,
        });
      }
      if (target === "actions") await win.setFocus();
      return;
    }

    stage = "scaleFactor";
    const scale = await win.scaleFactor();
    if (!context.isCurrent()) return;

    if (previousMode !== target
      && hasSameGeometry(previousMode, target)
      && hasSameGeometry(nativeModeRef.current, target)
      && hasSameGeometry(nativeTargetModeRef.current, target)
      && previousMode !== "full"
      && target !== "full") {
      modeRef.current = target;
      commitPresentation({
        mode: target,
        motion,
        phase: "stable",
        generation: context.generation,
      });
      if (target === "actions") await win.setFocus();
      return;
    }
    if (target === "idle") {
      stage = "collapse";
      await collapseBallWindow(state, previousMode, motion, scale, context);
      return;
    }

    if ((previousMode === "result" || previousMode === "full") && previousMode !== target && motion === "animated") {
      commitPresentation({ mode: previousMode, motion, phase: "full-exit", generation: context.generation });
      await waitForIslandTransition(ISLAND_TIMING.fullContentExitMs, context.signal);
      if (!context.isCurrent()) return;
    }

    stage = "measure";
    const bounds = await measureExpandedBounds(state, previousMode, target, scale, context);
    if (!bounds || !context.isCurrent()) return;
    const {
      nativeTarget, side, idleOuterWidth, targetWidthPixels, targetHeightPixels,
      estimatedOuterWidth, expandedX, expandedY,
    } = bounds;

    const shrinksExistingIsland = previousMode !== "idle" && shrinksIsland(previousMode, target);

    if (shrinksExistingIsland) {
      modeRef.current = target;
      commitPresentation({
        mode: target,
        motion,
        phase: "stable",
        generation: context.generation,
      });
      if (motion === "animated") {
        await waitForIslandTransition(getIslandSurfaceMs(target), context.signal);
      }
      if (!context.isCurrent()) return;
    }

    stage = "setBounds";
    nativeTargetModeRef.current = nativeTarget;
    const windowRect = paddedTargetCanvas({
      padsCanvas: nativeTarget === target,
      previous: previousMode,
      target,
      side,
      scale,
      motion,
      shrinks: shrinksExistingIsland,
      expandedX,
      expandedY,
      width: targetWidthPixels,
      height: targetHeightPixels,
    });
    await setBallWindowBounds(windowRect);
    nativeModeRef.current = nativeTarget;
    if (!context.isCurrent()) return;
    stage = "commit";
    anchorPositionRef.current = {
      x: getIdleAnchorX(side, expandedX, estimatedOuterWidth, idleOuterWidth),
      y: expandedY,
    };
    if (!shrinksExistingIsland) {
      modeRef.current = target;
      commitPresentation({
        mode: target,
        motion,
        phase: "stable",
        generation: context.generation,
      });
    }
    stage = "settle";
    const clipSpec = {
      target, nativeTarget, side, scale,
      windowX: windowRect.x,
      expandedY,
      windowWidth: windowRect.width,
      windowHeight: windowRect.height,
      settleMs: shrinksExistingIsland ? 0 : getIslandSurfaceMs(target),
      dockedEdges: dockedEdgesRef.current,
    };
    if (nativeTarget === target) {
      clipExpandedSurfaceDetached(
        { modeRef, nativeModeRef, transitionCoordinator }, clipSpec, context,
      );
    } else {
      await clipExpandedSurface(clipSpec, context.signal);
      if (!context.isCurrent()) return;
    }
    stage = "setFocus";
    if (target === "actions" || target === "full" || target === "result") await win.setFocus();
    if (target === "full" && motion === "animated") {
      await waitForIslandTransition(getIslandSurfaceMs(target), context.signal);
    }
    logInfo("ball.transition", "end", {
      to: target, mode: modeRef.current,
      native: nativeModeRef.current, nativeTarget: nativeTargetModeRef.current,
    });
  } catch (error) {
    if (context.signal.aborted || isIslandTransitionAborted(error)) {
      logInfo("ball.transition", "superseded", { from: previousMode, to: target, stage });
      return;
    }
    logError("ball.transition", "transition translation island failed", error);
    modeRef.current = "idle";
    commitPresentation({
      mode: "idle",
      motion: "instant",
      phase: "stable",
      generation: context.generation,
    });
    await rollbackIslandToIdle(state);
  }

}
