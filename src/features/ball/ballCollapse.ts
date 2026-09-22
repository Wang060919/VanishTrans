import { getCurrentWindow } from "@tauri-apps/api/window";
import { ISLAND_TIMING, type IslandMode, type IslandMotion } from "../islandModel";
import { waitForIslandTransition, type IslandTransitionContext } from "../islandTransitionCoordinator";
import { IDLE_WIDTH, IDLE_HEIGHT, saveBallPosition, setBallWindowBounds } from "./ballNative";
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

  if (previousMode === "full" && motion === "animated") {
    commitPresentation({
      mode: "full",
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

  if (motion === "animated") {
    await waitForIslandTransition(ISLAND_TIMING.surfaceMs, context.signal);
  }
  if (!context.isCurrent()) return;

  // Resize the native surface only after the visual collapse has completed.
  nativeTargetModeRef.current = "idle";
  await setBallWindowBounds(idleBounds);
  nativeModeRef.current = "idle";
  if (!context.isCurrent()) return;

  idleOuterSizeRef.current = await win.outerSize();
  if (!context.isCurrent()) return;
  anchorPositionRef.current = await saveBallPosition({ x: idleX, y: currentPos.y }, false);

}
