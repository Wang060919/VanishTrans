import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";
import { logError } from "../../lib/logger";
import { startWindowDragging } from "../../services/tauriBridge";
import { getIdleAnchorX, hasSameGeometry } from "../islandModel";
import { settleDroppedWindow } from "./ballSnapSettle";
import { useBallPointer } from "./ballPointer";
import { IDLE_WIDTH, IDLE_HEIGHT, saveBallPosition } from "./ballNative";
import { type BallState } from "./useBallState";
import { type BallActions } from "./useBallActions";

type BallDragState = Pick<BallState,
  "modeRef" | "nativeModeRef" | "dockSideRef" | "pointerOriginRef" |
  "pointerCaptureTargetRef" | "draggingRef" | "transitionCoordinator" | "lastDragEndedAtRef" |
  "anchorPositionRef" | "idleOuterSizeRef" | "statusTimerRef" | "fullPinnedRef" |
  "phaseRef" | "shouldReduceMotion" | "snapAnimSeqRef" |
  "setDragging" | "commitDockedEdges" | "setLandedAt"
> & Pick<BallActions, "scheduleStatusCollapse">;

export function useBallDrag(state: BallDragState) {
  const {
    modeRef, nativeModeRef, dockSideRef, pointerOriginRef, pointerCaptureTargetRef, draggingRef,
    transitionCoordinator, lastDragEndedAtRef, anchorPositionRef, idleOuterSizeRef, statusTimerRef,
    fullPinnedRef, phaseRef, shouldReduceMotion, snapAnimSeqRef,
    setDragging, commitDockedEdges, setLandedAt, scheduleStatusCollapse,
  } = state;
  const pointer = useBallPointer(state);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const origin = pointerOriginRef.current;
    const dragMode = modeRef.current;
    const modeIsDraggable = dragMode !== "full";
    // Moves ignored mid-transition still drop the origin, or a press that
    // began just before it would count the whole pre-transition travel.
    if (transitionCoordinator.isTransitioning && origin) {
      pointerOriginRef.current = null;
    }
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
    setDragging(true);
    transitionCoordinator.setPaused(true);
    if (dragMode === "status" && statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    lastDragEndedAtRef.current = performance.now();
    void (async () => {
      try {
        const win = getCurrentWindow();
        // `win.startDragging()` only posts the native move message on Windows
        // and resolves at drag START. The command polls GUI_INMOVESIZE until
        // release, so anchor saving and queue resume happen after the drag.
        const moved = await startWindowDragging();
        const endOuterSize = await win.outerSize();
        lastDragEndedAtRef.current = performance.now();

        // Drop-and-snap: slide to a nearby work-area edge, then persist the
        // anchor at wherever the window actually ended up.
        const settle = moved
          ? await settleDroppedWindow(
              win, dragMode, dockSideRef.current, shouldReduceMotion ?? false, snapAnimSeqRef,
            )
          : null;
        const endPosition: { x: number; y: number } = settle?.position
          ?? await win.outerPosition();
        if (settle) {
          commitDockedEdges(settle.edges);
          if (settle.landed) setLandedAt(performance.now());
        }
        if (dragMode === "peek"
          || dragMode === "actions"
          || dragMode === "status"
          || dragMode === "result"
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
        setDragging(false);
        transitionCoordinator.setPaused(false);
        // Re-arm even when a transition is queued: a status→status request
        // drains as a no-op and nothing else would reschedule the collapse.
        // The timer re-checks the effective mode before collapsing, so an
        // armed timer left behind by a real mode change is harmless.
        if (dragMode === "status" && modeRef.current === "status") {
          scheduleStatusCollapse(phaseRef.current);
        }
      }
    })();
  }, [
    scheduleStatusCollapse, transitionCoordinator, modeRef, nativeModeRef, dockSideRef, pointerOriginRef,
    pointerCaptureTargetRef, draggingRef, lastDragEndedAtRef, anchorPositionRef, idleOuterSizeRef,
    statusTimerRef, phaseRef, shouldReduceMotion, snapAnimSeqRef,
    setDragging, commitDockedEdges, setLandedAt,
  ]);

  const handleFullDragStart = useCallback(() => {
    if (modeRef.current !== "full"
      || transitionCoordinator.isTransitioning
      || draggingRef.current) {
      return false;
    }
    draggingRef.current = true;
    snapAnimSeqRef.current += 1;
    transitionCoordinator.setPaused(true);
    return true;
  }, [transitionCoordinator, modeRef, draggingRef, snapAnimSeqRef]);

  const handleFullDragEnd = useCallback(() => {
    draggingRef.current = false;
    transitionCoordinator.setPaused(false);
  }, [transitionCoordinator, draggingRef]);

  const handlePinChange = useCallback((pinned: boolean) => {
    fullPinnedRef.current = pinned;
  }, [fullPinnedRef]);

  return {
    ...pointer, handlePointerMove, handleFullDragStart, handleFullDragEnd, handlePinChange,
  };
}
export type BallDrag = ReturnType<typeof useBallDrag>;
