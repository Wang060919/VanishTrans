import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";
import { useCallback } from "react";
import { logError } from "../../lib/logger";
import { getExpandedX, getIdleAnchorX, ISLAND_WINDOW_POLICY } from "../islandModel";
import { IDLE_WIDTH, IDLE_HEIGHT, saveBallPosition } from "./ballNative";
import { type BallState } from "./useBallState";

type BallFullPositionState = Pick<BallState, "modeRef" | "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef">;

export function useBallFullPosition({ modeRef, dockSideRef, anchorPositionRef, idleOuterSizeRef }: BallFullPositionState) {
  const handleFullWindowMoved = useCallback(async () => {
    try {
      if (modeRef.current !== "full") return;
      const win = getCurrentWindow();
      const draggedPosition = await win.outerPosition();
      const outerSize = await win.outerSize();
      const innerSize = await win.innerSize();
      const monitor = await monitorFromPoint(
        draggedPosition.x + outerSize.width / 2,
        draggedPosition.y + Math.min(24, outerSize.height / 2),
      ) ?? await currentMonitor();
      const scale = monitor?.scaleFactor ?? await win.scaleFactor();
      const chromeWidth = outerSize.width - innerSize.width;
      const chromeHeight = outerSize.height - innerSize.height;
      const idleOuterWidth = Math.round(IDLE_WIDTH * scale) + chromeWidth;
      const idleOuterHeight = Math.round(IDLE_HEIGHT * scale) + chromeHeight;
      idleOuterSizeRef.current = { width: idleOuterWidth, height: idleOuterHeight };
      const edgeGutterPixels = Math.round(ISLAND_WINDOW_POLICY.edgeGutter * scale);
      const topGutterPixels = Math.round(ISLAND_WINDOW_POLICY.topGutter * scale);
      const snapDistancePixels = Math.round(ISLAND_WINDOW_POLICY.topSnapDistance * scale);
      let position = { x: draggedPosition.x, y: draggedPosition.y };

      if (monitor
        && draggedPosition.y <= monitor.workArea.position.y + snapDistancePixels) {
        const workLeft = monitor.workArea.position.x;
        const workRight = workLeft + monitor.workArea.size.width;
        const centeredAnchorX = workLeft
          + Math.round((monitor.workArea.size.width - idleOuterWidth) / 2);
        const rawSnappedX = getExpandedX(
          dockSideRef.current,
          centeredAnchorX,
          idleOuterWidth,
          outerSize.width,
        );
        const minX = workLeft + edgeGutterPixels;
        const maxX = Math.max(minX, workRight - outerSize.width - edgeGutterPixels);
        position = {
          x: Math.min(Math.max(rawSnappedX, minX), maxX),
          y: monitor.workArea.position.y + topGutterPixels,
        };
        await win.setPosition(new PhysicalPosition(position.x, position.y));
      }

      const anchor = {
        x: getIdleAnchorX(
          dockSideRef.current,
          position.x,
          outerSize.width,
          idleOuterWidth,
        ),
        y: position.y,
      };
      anchorPositionRef.current = await saveBallPosition(anchor, false);
    } catch (error) {
      logError("ball.drag", "save expanded translation island position failed", error);
    }
  }, [modeRef, dockSideRef, anchorPositionRef, idleOuterSizeRef]);

  return { handleFullWindowMoved };
}
export type BallFullPosition = ReturnType<typeof useBallFullPosition>;
