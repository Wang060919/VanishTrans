import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { flushSync } from "react-dom";
import {
  chooseDockSide, getExpandedX, getIdleAnchorX, getIslandGeometry, hasSameGeometry, ISLAND_WINDOW_POLICY,
  type IslandMode,
} from "../islandModel";
import { type IslandTransitionContext } from "../islandTransitionCoordinator";
import { IDLE_WIDTH, IDLE_HEIGHT, FULL_WIDTH } from "./ballNative";
import { type BallState } from "./useBallState";

type BallGeometryState = Pick<BallState, "nativeModeRef" | "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef" | "setDockSide">;

export async function measureExpandedBounds(state: BallGeometryState, previousMode: IslandMode, target: IslandMode, scale: number, context: IslandTransitionContext) {
  const { nativeModeRef, dockSideRef, anchorPositionRef, idleOuterSizeRef, setDockSide } = state;
  const win = getCurrentWindow();
  const idleWidthPixels = Math.round(IDLE_WIDTH * scale);
  const idleHeightPixels = Math.round(IDLE_HEIGHT * scale);
  const targetDimensions = getIslandGeometry(target);
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
    monitorLeft + edgeGutterPixels,
    monitorRight - estimatedOuterWidth - edgeGutterPixels,
  );
  const expandedX = Math.min(Math.max(rawExpandedX, monitorLeft + edgeGutterPixels), maxX);
  const maxY = Math.max(
    monitorTop + topGutterPixels,
    monitorBottom - estimatedOuterHeight - edgeGutterPixels,
  );
  const expandedY = Math.min(Math.max(anchor.y, monitorTop + topGutterPixels), maxY);

  return {
    side, currentPosition, currentOuterSize, idleOuterWidth, targetWidthPixels, targetHeightPixels,
    estimatedOuterWidth, estimatedOuterHeight, expandedX, expandedY,
  };
}
