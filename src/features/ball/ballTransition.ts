import { getCurrentWindow } from "@tauri-apps/api/window";
import { logError } from "../../lib/logger";
import { getIdleAnchorX, hasSameGeometry, ISLAND_TIMING, shrinksIsland } from "../islandModel";
import {
  isIslandTransitionAborted, waitForIslandPaint, waitForIslandTransition, type IslandTransitionContext,
  type IslandTransitionRequest,
} from "../islandTransitionCoordinator";
import { measureExpandedBounds } from "./ballGeometry";
import { collapseBallWindow } from "./ballCollapse";
import { IDLE_WIDTH, IDLE_HEIGHT, setBallWindowBounds } from "./ballNative";
import { type BallState } from "./useBallState";

type BallTransitionState = Pick<BallState,
  "modeRef" | "nativeModeRef" | "nativeTargetModeRef" | "presentationRef" |
  "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef" | "noticeRef" |
  "commitPresentation" | "setDockSide" | "setNotice"
>;

export async function runBallTransition(state: BallTransitionState, request: IslandTransitionRequest, context: IslandTransitionContext) {
  const {
    modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, anchorPositionRef, commitPresentation,
  } = state;
  const { target, motion } = request;
  const win = getCurrentWindow();
  const previousMode = modeRef.current;
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
      await collapseBallWindow(state, previousMode, motion, scale, context);
      return;
    }

    const bounds = await measureExpandedBounds(state, previousMode, target, scale, context);
    if (!bounds || !context.isCurrent()) return;
    const {
      side, currentPosition, currentOuterSize, idleOuterWidth, targetWidthPixels, targetHeightPixels,
      estimatedOuterWidth, estimatedOuterHeight, expandedX, expandedY,
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
        await waitForIslandTransition(ISLAND_TIMING.surfaceMs, context.signal);
      }
      if (!context.isCurrent()) return;
    }

    const revealsExistingActionsSurface = previousMode === "idle"
      && (target === "peek" || target === "actions")
      && hasSameGeometry(nativeModeRef.current, target)
      && currentPosition.x === expandedX
      && currentPosition.y === expandedY
      && currentOuterSize.width === estimatedOuterWidth
      && currentOuterSize.height === estimatedOuterHeight;

    if (revealsExistingActionsSurface) {
      modeRef.current = target;
      commitPresentation({
        mode: target,
        motion,
        phase: "stable",
        generation: context.generation,
      });
      await waitForIslandPaint(context.signal);
      if (!context.isCurrent()) return;
    }

    nativeTargetModeRef.current = target;
    await setBallWindowBounds({
      x: expandedX,
      y: expandedY,
      width: targetWidthPixels,
      height: targetHeightPixels,
    });
    nativeModeRef.current = target;
    if (!context.isCurrent()) return;
    anchorPositionRef.current = {
      x: getIdleAnchorX(side, expandedX, estimatedOuterWidth, idleOuterWidth),
      y: expandedY,
    };
    if (!shrinksExistingIsland && !revealsExistingActionsSurface) {
      modeRef.current = target;
      commitPresentation({
        mode: target,
        motion,
        phase: "stable",
        generation: context.generation,
      });
    }
    if (target === "actions" || target === "full") await win.setFocus();
    if (target === "full" && motion === "animated") {
      await waitForIslandTransition(ISLAND_TIMING.surfaceMs, context.signal);
    }
  } catch (error) {
    if (context.signal.aborted || isIslandTransitionAborted(error)) return;
    logError("ball.transition", "transition translation island failed", error);
    modeRef.current = "idle";
    commitPresentation({
      mode: "idle",
      motion: "instant",
      phase: "stable",
      generation: context.generation,
    });
    try {
      const scale = await win.scaleFactor();
      const anchor = anchorPositionRef.current;
      if (anchor) {
        nativeTargetModeRef.current = "idle";
        await setBallWindowBounds({
          x: anchor.x,
          y: anchor.y,
          width: Math.round(IDLE_WIDTH * scale),
          height: Math.round(IDLE_HEIGHT * scale),
        });
        nativeModeRef.current = "idle";
      }
    } catch (rollbackError) {
      logError("ball.transition", "rollback translation island failed", rollbackError);
    }
  }

}
