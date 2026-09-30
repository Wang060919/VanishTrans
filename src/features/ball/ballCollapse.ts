import { getCurrentWindow } from "@tauri-apps/api/window";
import { getIslandSurfaceMs, ISLAND_TIMING, type IslandMode, type IslandMotion } from "../islandModel";
import { waitForIslandTransition, type IslandTransitionContext } from "../islandTransitionCoordinator";
import { IDLE_WIDTH, IDLE_HEIGHT, saveBallPosition, setBallWindowBounds } from "./ballNative";
import { settleBallSurface } from "./ballSurfaceSettlement";
import { type BallState } from "./useBallState";

type BallCollapseState = Pick<BallState,
  "modeRef" | "nativeModeRef" | "nativeTargetModeRef" | "dockSideRef" |
  "anchorPositionRef" | "idleOuterSizeRef" | "noticeRef" | "commitPresentation" |
  "setNotice"
>;

export async function collapseBallWindow(state: BallCollapseState, previousMode: IslandMode, motion: IslandMotion, scale: number, context: IslandTransitionContext) {
  const {
    modeRef, nativeModeRef, nativeTargetModeRef, dockSideRef, anchorPositionRef, idleOuterSizeRef, noticeRef,
    commitPresentation, setNotice,
  } = state;
  const win = getCurrentWindow();
  const idleWidthPixels = Math.round(IDLE_WIDTH * scale);
  const idleHeightPixels = Math.round(IDLE_HEIGHT * scale);
  const currentPos = await win.outerPosition();
  const currentSize = await win.outerSize();
  if (!context.isCurrent()) return;

  if ((previousMode === "full" || previousMode === "result") && motion === "animated") {
    commitPresentation({
      mode: previousMode,
      motion,
      phase: "full-exit",
      generation: context.generation,
    });
    await waitForIslandTransition(ISLAND_TIMING.fullContentExitMs, context.signal);
  }

  const side = dockSideRef.current;
  let idleX = currentPos.x;
  if (side === "center") {
    idleX = currentPos.x + Math.round((currentSize.width - idleWidthPixels) / 2);
  } else if (side === "left") {
    idleX = currentPos.x + currentSize.width - idleWidthPixels;
  }
  const idleBounds = {
    x: idleX,
    y: currentPos.y,
    width: idleWidthPixels,
    height: idleHeightPixels,
  };

  modeRef.current = "idle";
  noticeRef.current = "";
  setNotice("");
  commitPresentation({
    mode: "idle",
    motion,
    phase: "stable",
    generation: context.generation,
  });

  await settleBallSurface(motion === "animated" ? getIslandSurfaceMs("idle") : 0, context.signal);
  if (!context.isCurrent()) return;

  // Keep the WebView viewport stationary on Windows; clip only after the morph.
  const retained = await setBallWindowBounds({ ...idleBounds, retainSurface: true });
  if (!retained) {
    nativeTargetModeRef.current = "idle";
    nativeModeRef.current = "idle";
  }
  if (!context.isCurrent()) return;

  idleOuterSizeRef.current = retained
    ? { width: idleWidthPixels, height: idleHeightPixels }
    : await win.outerSize();
  if (!context.isCurrent()) return;
  anchorPositionRef.current = await saveBallPosition({ x: idleX, y: currentPos.y }, false);

}
