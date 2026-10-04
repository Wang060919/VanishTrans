import { useCallback } from "react";
import { logInfo } from "../../lib/logger";
import { type BallState } from "./useBallState";

type BallPointerState = Pick<BallState,
  "modeRef" | "pointerOriginRef" | "pointerCaptureTargetRef" |
  "snapAnimSeqRef" | "transitionCoordinator">;

/** Press bookkeeping: origin capture, release hygiene, snap-cancel on grab. */
export function useBallPointer({
  modeRef, pointerOriginRef, pointerCaptureTargetRef, snapAnimSeqRef, transitionCoordinator,
}: BallPointerState) {
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const modeIsDraggable = modeRef.current !== "full";
    const surface = document.querySelector<HTMLElement>(".translation-island__surface");
    const surfaceRect = surface?.getBoundingClientRect();
    logInfo("ball.input", "pointerdown", {
      mode: modeRef.current,
      domMode: surface?.getAttribute("data-mode"),
      surfaceX: surfaceRect ? Math.round(surfaceRect.left) : null,
      surfaceW: surfaceRect ? Math.round(surfaceRect.width) : null,
      button: event.button,
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      target: event.target instanceof Element
        ? (event.target.getAttribute("class") ?? event.target.tagName).slice(0, 80)
        : "non-element",
      transitioning: transitionCoordinator.isTransitioning,
      requested: transitionCoordinator.requestedTarget,
      skipped: !modeIsDraggable || transitionCoordinator.isTransitioning || event.button !== 0,
    });
    if (!modeIsDraggable || event.button !== 0) return;
    // A refused press drops any leftover origin so pre-transition travel can't count.
    if (transitionCoordinator.isTransitioning) {
      pointerOriginRef.current = null;
      return;
    }
    if (modeRef.current === "result" && event.target instanceof Element
      && !event.target.closest(".quick-translate-header")) return;
    if (modeRef.current === "result" && event.target instanceof Element
      && event.target.closest("button")) return;
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
    // A fresh grab cancels any snap settle still sliding toward a docked edge.
    snapAnimSeqRef.current += 1;
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
  }, [transitionCoordinator, modeRef, pointerOriginRef, pointerCaptureTargetRef, snapAnimSeqRef]);

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

  return { handlePointerDown, handlePointerEnd, clearPointerOrigin };
}
export type BallPointer = ReturnType<typeof useBallPointer>;
