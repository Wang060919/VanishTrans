import { getCurrentWindow } from "@tauri-apps/api/window";
import { logError } from "../../lib/logger";
import { IDLE_WIDTH, IDLE_HEIGHT, setBallWindowBounds } from "./ballNative";
import { type BallState } from "./useBallState";

type BallRollbackState = Pick<BallState,
  "nativeModeRef" | "nativeTargetModeRef" | "anchorPositionRef"
>;

/**
 * Roll the window back to the idle capsule after a failed transition and
 * reconcile the native bookkeeping with what is actually on screen. Without a
 * stored anchor (a failed first expand) the live outer position stands in, so
 * the native refs are never left pointing at a target geometry that was never
 * applied — otherwise the next request's same-geometry early-out would skip
 * the bounds correction the failed attempt owed.
 */
export async function rollbackIslandToIdle(state: BallRollbackState) {
  const { nativeModeRef, nativeTargetModeRef, anchorPositionRef } = state;
  try {
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    const anchor = anchorPositionRef.current ?? await win.outerPosition();
    nativeTargetModeRef.current = "idle";
    await setBallWindowBounds({
      x: anchor.x,
      y: anchor.y,
      width: Math.round(IDLE_WIDTH * scale),
      height: Math.round(IDLE_HEIGHT * scale),
    });
    nativeModeRef.current = "idle";
  } catch (error) {
    logError("ball.transition", "rollback translation island failed", error);
  } finally {
    // Best effort failed too: at least stop advertising the unapplied target.
    nativeTargetModeRef.current = nativeModeRef.current;
  }
}
