import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";
import { logError } from "../../lib/logger";
import { getIdleAnchorX, hasSameGeometry } from "../islandModel";
import { IDLE_WIDTH, IDLE_HEIGHT, saveBallPosition } from "./ballNative";
import { type BallState } from "./useBallState";
import { type BallActions } from "./useBallActions";

type BallDragState = Pick<BallState,
  "modeRef" | "nativeModeRef" | "dockSideRef" | "pointerOriginRef" |
  "pointerCaptureTargetRef" | "draggingRef" | "transitionCoordinator" | "lastDragEndedAtRef" |
  "anchorPositionRef" | "idleOuterSizeRef" | "statusTimerRef" | "fullPinnedRef" |
  "phaseRef"
> & Pick<BallActions, "scheduleStatusCollapse">;

export function useBallDrag({
  modeRef, nativeModeRef, dockSideRef, pointerOriginRef, pointerCaptureTargetRef, draggingRef,
  transitionCoordinator, lastDragEndedAtRef, anchorPositionRef, idleOuterSizeRef, statusTimerRef,
  fullPinnedRef, phaseRef, scheduleStatusCollapse,
}: BallDragState) {
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const modeIsDraggable = modeRef.current !== "full";
    if (!modeIsDraggable || transitionCoordinator.isTransitioning || event.button !== 0) return;
    const captureTarget = event.target instanceof Element
      ? event.target.closest("button") ?? event.currentTarget
      : event.currentTarget;
    try {
      captureTarget.setPointerCapture(event.pointerId);
      pointerCaptureTargetRef.current = captureTarget;
    } catch {
      // Native WebViews can take over pointer capture while starting a window drag.
      pointerCaptureTargetRef.current = null;
    }
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
  }, [transitionCoordinator, modeRef, pointerOriginRef, pointerCaptureTargetRef]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const origin = pointerOriginRef.current;
    const dragMode = modeRef.current;
    const modeIsDraggable = dragMode !== "full";
    if (!origin || draggingRef.current || !modeIsDraggable || transitionCoordinator.isTransitioning) {
      return;
    }
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6) return;

    pointerOriginRef.current = null;
    const captureTarget = pointerCaptureTargetRef.current;
    pointerCaptureTargetRef.current = null;
    try {
      if (captureTarget?.hasPointerCapture(event.pointerId)) {
        captureTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The native drag loop may already have released capture.
    }
    draggingRef.current = true;
    transitionCoordinator.setPaused(true);
    if (dragMode === "status" && statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    lastDragEndedAtRef.current = performance.now();
    void (async () => {
      try {
        const win = getCurrentWindow();
        await win.startDragging();
        const endPosition = await win.outerPosition();
        const endOuterSize = await win.outerSize();
        lastDragEndedAtRef.current = performance.now();

        if (dragMode === "peek"
          || dragMode === "actions"
          || dragMode === "status"
          || (dragMode === "idle" && !hasSameGeometry(nativeModeRef.current, "idle"))) {
          const scale = await win.scaleFactor();
          const endInnerSize = await win.innerSize();
          const chromeWidth = endOuterSize.width - endInnerSize.width;
          const chromeHeight = endOuterSize.height - endInnerSize.height;
          const idleOuterWidth = Math.round(IDLE_WIDTH * scale) + chromeWidth;
          idleOuterSizeRef.current = {
            width: idleOuterWidth,
            height: Math.round(IDLE_HEIGHT * scale) + chromeHeight,
          };
          const anchor = {
            x: getIdleAnchorX(
              dockSideRef.current,
              endPosition.x,
              endOuterSize.width,
              idleOuterWidth,
            ),
            y: endPosition.y,
          };
          anchorPositionRef.current = await saveBallPosition(anchor, false);
        } else {
          const anchor = { x: endPosition.x, y: endPosition.y };
          anchorPositionRef.current = anchor;
          idleOuterSizeRef.current = endOuterSize;
          anchorPositionRef.current = await saveBallPosition(anchor);
        }
      } catch (error) {
        logError("ball.drag", "drag translation island failed", error);
      } finally {
        draggingRef.current = false;
        transitionCoordinator.setPaused(false);
        if (dragMode === "status"
          && modeRef.current === "status"
          && transitionCoordinator.requestedTarget === null) {
          scheduleStatusCollapse(phaseRef.current);
        }
      }
    })();
  }, [
    scheduleStatusCollapse, transitionCoordinator, modeRef, nativeModeRef, dockSideRef, pointerOriginRef,
    pointerCaptureTargetRef, draggingRef, lastDragEndedAtRef, anchorPositionRef, idleOuterSizeRef,
    statusTimerRef, phaseRef,
  ]);

  const clearPointerOrigin = useCallback(() => {
    pointerOriginRef.current = null;
    pointerCaptureTargetRef.current = null;
  }, [pointerOriginRef, pointerCaptureTargetRef]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLElement>) => {
    pointerOriginRef.current = null;
    const captureTarget = pointerCaptureTargetRef.current;
    pointerCaptureTargetRef.current = null;
    try {
      if (captureTarget?.hasPointerCapture(event.pointerId)) {
        captureTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture is optional in browser-only previews and test environments.
    }
  }, [pointerOriginRef, pointerCaptureTargetRef]);

  const handleFullDragStart = useCallback(() => {
    if (modeRef.current !== "full"
      || transitionCoordinator.isTransitioning
      || draggingRef.current) {
      return false;
    }
    draggingRef.current = true;
    transitionCoordinator.setPaused(true);
    return true;
  }, [transitionCoordinator, modeRef, draggingRef]);

  const handleFullDragEnd = useCallback(() => {
    draggingRef.current = false;
    transitionCoordinator.setPaused(false);
  }, [transitionCoordinator, draggingRef]);

  const handlePinChange = useCallback((pinned: boolean) => {
    fullPinnedRef.current = pinned;
  }, [fullPinnedRef]);

  return {
    handlePointerDown, handlePointerMove, handlePointerEnd, clearPointerOrigin, handleFullDragStart,
    handleFullDragEnd, handlePinChange,
  };
}
export type BallDrag = ReturnType<typeof useBallDrag>;
