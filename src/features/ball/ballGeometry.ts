import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { flushSync } from "react-dom";
import {
  chooseDockSide, getExpandedX, getIdleAnchorX, getIslandClipPad, getIslandGeometry,
  getIslandMorphHeadroom, hasSameGeometry, ISLAND_WINDOW_POLICY,
  type DockSide, type IslandMode, type IslandMotion,
} from "../islandModel";
import { type IslandTransitionContext } from "../islandTransitionCoordinator";
import { IDLE_WIDTH, IDLE_HEIGHT, FULL_WIDTH } from "./ballNative";
import { type BallState } from "./useBallState";

type BallGeometryState = Pick<BallState,
  "nativeModeRef" | "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef" |
  "setDockSide" | "dockedEdgesRef">;

export async function measureExpandedBounds(state: BallGeometryState, previousMode: IslandMode, target: IslandMode, scale: number, context: IslandTransitionContext) {
  const { nativeModeRef, dockSideRef, anchorPositionRef, idleOuterSizeRef, setDockSide, dockedEdgesRef } = state;
  const win = getCurrentWindow();
  const idleWidthPixels = Math.round(IDLE_WIDTH * scale);
  const idleHeightPixels = Math.round(IDLE_HEIGHT * scale);
  // Once a larger viewport exists, keep it warm; only the island morphs.
  // Result cards are rounded rectangles, so never clip them with the capsule region.
  const nativeTarget = nativeModeRef.current === "full" && target !== "result" ? "full" : target;
  const targetDimensions = getIslandGeometry(nativeTarget);
  const currentPosition = await win.outerPosition();
  const currentOuterSize = await win.outerSize();
  const currentInnerSize = await win.innerSize();
  const monitor = await currentMonitor();
  if (!context.isCurrent()) return;
  const chromeWidth = currentOuterSize.width - currentInnerSize.width;
  const chromeHeight = currentOuterSize.height - currentInnerSize.height;

  if (previousMode === "idle" || !anchorPositionRef.current) {
    if (previousMode === "idle" && !hasSameGeometry(nativeModeRef.current, "idle")) {
      const idleOuterWidth = idleWidthPixels + chromeWidth;
      const idleOuterHeight = idleHeightPixels + chromeHeight;
      anchorPositionRef.current = {
        x: getIdleAnchorX(
          dockSideRef.current,
          currentPosition.x,
          currentOuterSize.width,
          idleOuterWidth,
        ),
        y: currentPosition.y,
      };
      idleOuterSizeRef.current = {
        width: idleOuterWidth,
        height: idleOuterHeight,
      };
    } else {
      anchorPositionRef.current = { x: currentPosition.x, y: currentPosition.y };
      idleOuterSizeRef.current = currentOuterSize;
    }
  }
  const anchor = anchorPositionRef.current ?? { x: currentPosition.x, y: currentPosition.y };
  const idleOuterSize = idleOuterSizeRef.current;
  const idleOuterWidth = idleOuterSize?.width ?? idleWidthPixels + chromeWidth;
  const { width: targetWidth, height: targetHeight } = targetDimensions;
  const targetWidthPixels = Math.round(targetWidth * scale);
  const targetHeightPixels = Math.round(targetHeight * scale);
  const estimatedOuterWidth = targetWidthPixels + chromeWidth;
  const estimatedOuterHeight = targetHeightPixels + chromeHeight;
  const edgeGutterPixels = Math.round(ISLAND_WINDOW_POLICY.edgeGutter * scale);
  const topGutterPixels = Math.round(ISLAND_WINDOW_POLICY.topGutter * scale);
  // Edges the capsule is docked against stay flush when it expands — reusing
  // the gutter there would leave a visible gap between island and screen edge.
  const docked = dockedEdgesRef.current;
  const leftGutter = docked.includes("left") ? 0 : edgeGutterPixels;
  const rightGutter = docked.includes("right") ? 0 : edgeGutterPixels;
  const topGutterDocked = docked.includes("top") ? 0 : topGutterPixels;
  const bottomGutter = docked.includes("bottom") ? 0 : edgeGutterPixels;
  const monitorLeft = monitor?.position.x ?? 0;
  const monitorTop = monitor?.position.y ?? 0;
  const monitorRight = monitor
    ? monitor.position.x + monitor.size.width
    : anchor.x + estimatedOuterWidth;
  const monitorBottom = monitor
    ? monitor.position.y + monitor.size.height
    : anchor.y + estimatedOuterHeight;
  let side = dockSideRef.current;
  if (previousMode === "idle") {
    const preferredOuterWidth = Math.max(
      estimatedOuterWidth,
      Math.round(FULL_WIDTH * scale) + chromeWidth,
    );
    side = chooseDockSide(
      anchor.x,
      idleOuterWidth,
      preferredOuterWidth,
      monitorLeft,
      monitorRight,
      edgeGutterPixels,
    );
  }

  dockSideRef.current = side;
  flushSync(() => setDockSide(side));
  const rawExpandedX = getExpandedX(
    side,
    anchor.x,
    idleOuterWidth,
    estimatedOuterWidth,
  );
  const maxX = Math.max(
    monitorLeft + leftGutter,
    monitorRight - estimatedOuterWidth - rightGutter,
  );
  const expandedX = Math.min(Math.max(rawExpandedX, monitorLeft + leftGutter), maxX);
  const maxY = Math.max(
    monitorTop + topGutterDocked,
    monitorBottom - estimatedOuterHeight - bottomGutter,
  );
  const expandedY = Math.min(Math.max(anchor.y, monitorTop + topGutterDocked), maxY);

  return {
    nativeTarget, side, currentPosition, currentOuterSize, idleOuterWidth, targetWidthPixels, targetHeightPixels,
    estimatedOuterWidth, estimatedOuterHeight, expandedX, expandedY,
  };
}

/**
 * The native canvas for a freshly targeted mode, padded on the sides the
 * surface grows toward (and below it): the spring overshoot and the capsule's
 * press bulge paint into that margin instead of clipping flat at the window
 * edge. The post-settle region clip then re-tightens the hit area to the
 * visual bounds. A retained full canvas and shrinking morphs (which already
 * played out inside the old canvas) need no padding.
 */
export function paddedTargetCanvas({
  padsCanvas, previous, target, side, scale, motion, shrinks,
  expandedX, expandedY, width, height,
}: {
  padsCanvas: boolean;
  previous: IslandMode;
  target: IslandMode;
  side: DockSide;
  scale: number;
  motion: IslandMotion;
  shrinks: boolean;
  expandedX: number;
  expandedY: number;
  width: number;
  height: number;
}) {
  const edgePad = padsCanvas ? getIslandClipPad(target, scale) : 0;
  const headroom = padsCanvas && motion === "animated" && !shrinks
    ? getIslandMorphHeadroom(previous, target, scale)
    : { x: 0, y: 0 };
  const padX = edgePad + headroom.x;
  const padLeft = side === "right" ? 0 : padX;
  const padRight = side === "left" ? 0 : padX;
  return {
    x: expandedX - padLeft,
    y: expandedY,
    width: width + padLeft + padRight,
    height: height + edgePad + headroom.y,
  };
}
