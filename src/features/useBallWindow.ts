import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useThemeSync } from "../hooks/useTheme";
import { errorMessage } from "../lib/errors";
import { logError } from "../lib/logger";
import {
  saveBallPosition as saveBallPositionCmd,
  setBallWindowBounds as setBallWindowBoundsCmd,
  startScreenshotFromBall,
  toggleBallShowMain,
  translateClipboardFromBall,
} from "../services/tauriBridge";
import {
  chooseDockSide,
  getExpandedX,
  getIdleAnchorX,
  getIslandGeometry,
  hasSameGeometry,
  ISLAND_GEOMETRY,
  ISLAND_TIMING,
  ISLAND_WINDOW_POLICY,
  shrinksIsland,
  type BallAction,
  type DockSide,
  type IslandMode,
  type IslandMotion,
  type IslandPhase,
  type IslandPresentation,
} from "./islandModel";
import {
  IslandTransitionCoordinator,
  isIslandTransitionAborted,
  waitForIslandPaint,
  waitForIslandTransition,
  type IslandTransitionContext,
  type IslandTransitionReason,
  type IslandTransitionRequest,
} from "./islandTransitionCoordinator";

const IDLE_WIDTH = ISLAND_GEOMETRY.idle.width;
const IDLE_HEIGHT = ISLAND_GEOMETRY.idle.height;
const FULL_WIDTH = ISLAND_GEOMETRY.full.width;
// REMOVED: Fixed actions surface causes title bar issues due to SetWindowRgn
// RustyIsland (same Tauri v2 stack) doesn't use SetWindowRgn and has no title bar issues
// See: https://github.com/hasnain7abbas/RustyIsland
const USES_FIXED_ACTIONS_SURFACE = false;

interface TransitionOptions {
  motion?: IslandMotion;
  reason?: IslandTransitionReason;
}

interface TranslationActivity {
  state?: string;
}

export function normalizeTranslationActivity(payload: unknown): IslandPhase | "idle" | null {
  if (payload === true) return "working";
  if (payload === false) return "done";
  if (!payload || typeof payload !== "object") return null;
  const state = (payload as TranslationActivity).state;
  if (state === "working" || state === "done" || state === "error" || state === "idle") {
    return state;
  }
  return null;
}

const COMMAND_MAP: Record<string, () => Promise<void>> = {
  translate_clipboard_from_ball: translateClipboardFromBall,
  start_screenshot_from_ball: startScreenshotFromBall,
  toggle_ball_show_main: toggleBallShowMain,
};

async function invokeCommand(command: string) {
  const fn = COMMAND_MAP[command];
  if (fn) return fn();
  throw new Error(`未知命令: ${command}`);
}

async function setBallWindowBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  await setBallWindowBoundsCmd(bounds);
}

async function saveBallPosition(
  position: { x: number; y: number },
  reposition = true,
) {
  try {
    const saved = await saveBallPositionCmd({
      ...position,
      reposition,
    });
    return Array.isArray(saved) && saved.length === 2
      ? { x: saved[0], y: saved[1] }
      : position;
  } catch (error) {
    // Position persistence is best-effort: keep the in-memory anchor even if
    // writing config.json fails so the island never resets mid-transition.
    logError("ball.position", "save position failed", error);
    return position;
  }
}

export function useBallWindow() {
  const initialPresentation: IslandPresentation = {
    mode: "idle",
    motion: "instant",
    phase: "stable",
    generation: 0,
  };
  const [presentation, setPresentation] = useState<IslandPresentation>(initialPresentation);
  const [phase, setPhase] = useState<IslandPhase>("working");
  const [dockSide, setDockSide] = useState<DockSide>("center");
  const [busyAction, setBusyAction] = useState<BallAction | null>(null);
  const [notice, setNotice] = useState("");
  const shouldReduceMotion = useReducedMotion();
  const mode = presentation.mode;

  const modeRef = useRef<IslandMode>("idle");
  const nativeModeRef = useRef<IslandMode>(USES_FIXED_ACTIONS_SURFACE ? "actions" : "idle");
  const nativeTargetModeRef = useRef<IslandMode>(USES_FIXED_ACTIONS_SURFACE ? "actions" : "idle");
  const presentationRef = useRef<IslandPresentation>(initialPresentation);
  const dockSideRef = useRef<DockSide>("center");
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pointerCaptureTargetRef = useRef<Element | null>(null);
  const draggingRef = useRef(false);
  const transitionCoordinatorRef = useRef<IslandTransitionCoordinator | null>(null);
  if (!transitionCoordinatorRef.current) {
    transitionCoordinatorRef.current = new IslandTransitionCoordinator();
  }
  const transitionCoordinator = transitionCoordinatorRef.current;
  const coordinatorLifetimeRef = useRef(0);
  const lastDragEndedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const anchorPositionRef = useRef<{ x: number; y: number } | null>(null);
  const idleOuterSizeRef = useRef<{ width: number; height: number } | null>(null);
  const expectingTranslationRef = useRef(false);
  const busyActionRef = useRef<BallAction | null>(null);
  const noticeRef = useRef("");
  const expectedActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullPinnedRef = useRef(false);
  const phaseRef = useRef<IslandPhase>("working");

  const commitPresentation = useCallback((next: IslandPresentation) => {
    presentationRef.current = next;
    flushSync(() => setPresentation(next));
  }, []);

  const runTransition = useCallback(async (
    request: IslandTransitionRequest,
    context: IslandTransitionContext,
  ) => {
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
      const idleWidthPixels = Math.round(IDLE_WIDTH * scale);
      const idleHeightPixels = Math.round(IDLE_HEIGHT * scale);
      const targetDimensions = getIslandGeometry(target);

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

        // Fixed surface optimization removed - caused title bar issues
        // Now always adjust window bounds directly
        nativeTargetModeRef.current = "idle";
        await setBallWindowBounds(idleBounds);
        nativeModeRef.current = "idle";
        if (!context.isCurrent()) return;

        idleOuterSizeRef.current = await win.outerSize();
        if (!context.isCurrent()) return;
        anchorPositionRef.current = await saveBallPosition({ x: idleX, y: currentPos.y }, false);
        return;
      }

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
  }, [commitPresentation]);

  const transitionMode = useCallback((
    target: IslandMode,
    options: TransitionOptions = {},
  ) => {
    if (target === "full" && statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    const request: IslandTransitionRequest = {
      target,
      motion: shouldReduceMotion ? "instant" : options.motion ?? "animated",
      reason: options.reason ?? "user",
    };
    return transitionCoordinator.request(request, runTransition);
  }, [runTransition, shouldReduceMotion, transitionCoordinator]);

  const scheduleStatusCollapse = useCallback((statusPhase: IslandPhase) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
    if (statusPhase === "working") return;
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      if (effectiveMode === "status") {
        void transitionMode("idle", { reason: "business" });
      }
    }, statusPhase === "done" ? 1250 : 1900);
  }, [transitionCoordinator, transitionMode]);

  const handleIslandBlur = useCallback((event: React.FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (modeRef.current === "actions"
      && !transitionCoordinator.isTransitioning
      && !draggingRef.current
      && busyActionRef.current === null
      && !expectingTranslationRef.current
      && !noticeRef.current) {
      void transitionMode("idle", { motion: "instant", reason: "focus-loss" });
    }
  }, [transitionCoordinator, transitionMode]);

  const toggleActions = useCallback(async () => {
    if (modeRef.current === "actions") await transitionMode("idle");
    else if (modeRef.current === "peek") await transitionMode("actions");
    else if (modeRef.current === "idle") await transitionMode("actions");
  }, [transitionMode]);

  const handleCoreClick = useCallback(async () => {
    if (draggingRef.current || performance.now() - lastDragEndedAtRef.current < 250) return;
    if (modeRef.current === "status") {
      if (phase !== "working") await transitionMode("idle");
      return;
    }
    await toggleActions();
  }, [phase, toggleActions, transitionMode]);

  const expandFull = useCallback(async () => {
    await transitionMode("full");
  }, [transitionMode]);

  const collapseFull = useCallback(async () => {
    await transitionMode("idle");
  }, [transitionMode]);

  const showNotice = useCallback((message: string) => {
    noticeRef.current = message;
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      noticeRef.current = "";
      setNotice("");
    }, 2200);
  }, []);

  const runAction = useCallback(async (action: BallAction, command: string) => {
    if (draggingRef.current || performance.now() - lastDragEndedAtRef.current < 250) return;
    if (action === "main") {
      busyActionRef.current = action;
      setBusyAction(action);
      try {
        await expandFull();
      } finally {
        busyActionRef.current = null;
        setBusyAction(null);
      }
      return;
    }

    const expectsTranslationState = action === "clipboard";
    if (expectsTranslationState) {
      expectingTranslationRef.current = true;
      if (expectedActivityTimerRef.current) clearTimeout(expectedActivityTimerRef.current);
    }
    busyActionRef.current = action;
    setBusyAction(action);
    try {
      await invokeCommand(command);
      if (expectsTranslationState) {
        if (expectingTranslationRef.current) {
          expectedActivityTimerRef.current = setTimeout(() => {
            expectingTranslationRef.current = false;
            expectedActivityTimerRef.current = null;
            if (modeRef.current === "peek" || modeRef.current === "actions") {
              void transitionMode("idle");
            }
          }, 900);
        }
      } else {
        await transitionMode("idle");
      }
    } catch (error) {
      expectingTranslationRef.current = false;
      if (expectedActivityTimerRef.current) {
        clearTimeout(expectedActivityTimerRef.current);
        expectedActivityTimerRef.current = null;
      }
      const message = errorMessage(error);
      showNotice(message || "操作失败，请重试");
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  }, [expandFull, showNotice, transitionMode]);

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
  }, [transitionCoordinator]);

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
  }, [scheduleStatusCollapse, transitionCoordinator]);

  const clearPointerOrigin = useCallback(() => {
    pointerOriginRef.current = null;
    pointerCaptureTargetRef.current = null;
  }, []);

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
  }, []);

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
  }, []);

  const handleFullDragStart = useCallback(() => {
    if (modeRef.current !== "full"
      || transitionCoordinator.isTransitioning
      || draggingRef.current) {
      return false;
    }
    draggingRef.current = true;
    transitionCoordinator.setPaused(true);
    return true;
  }, [transitionCoordinator]);

  const handleFullDragEnd = useCallback(() => {
    draggingRef.current = false;
    transitionCoordinator.setPaused(false);
  }, [transitionCoordinator]);

  const handlePinChange = useCallback((pinned: boolean) => {
    fullPinnedRef.current = pinned;
  }, []);

  useThemeSync();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!document.documentElement.dataset.theme) {
        const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
      }
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.body.classList.add("ball-window-body");
    return () => document.body.classList.remove("ball-window-body");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("ball-window-body--full", mode === "full");
    return () => document.body.classList.remove("ball-window-body--full");
  }, [mode]);

  useEffect(() => {
    if (mode !== "status" || phase === "working" || draggingRef.current) return;
    scheduleStatusCollapse(phase);

    return () => {
      if (!statusTimerRef.current) return;
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    };
  }, [mode, phase, scheduleStatusCollapse]);

  useEffect(() => {
    const translationListener = listen<unknown>("translation-state", (event) => {
      const activity = normalizeTranslationActivity(event.payload);
      if (!activity) return;
      expectingTranslationRef.current = false;
      if (expectedActivityTimerRef.current) {
        clearTimeout(expectedActivityTimerRef.current);
        expectedActivityTimerRef.current = null;
      }
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }

      const fullIsActiveOrPending = modeRef.current === "full"
        || transitionCoordinator.requestedTarget === "full";
      if (fullIsActiveOrPending) {
        phaseRef.current = activity;
        setPhase(activity);
        return;
      }

      if (activity === "idle") {
        void transitionMode("idle", { reason: "business" });
        return;
      }

      phaseRef.current = activity;
      setPhase(activity);
      void transitionMode("status", { reason: "business" });
    });
    const focusListener = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      const shouldCollapseActions = (effectiveMode === "peek" || effectiveMode === "actions")
        && !expectingTranslationRef.current;
      const shouldCollapseFull = effectiveMode === "full"
        && !fullPinnedRef.current;
      if (!focused && shouldCollapseActions) {
        void transitionMode("idle", { reason: "focus-loss" });
      } else if (!focused && shouldCollapseFull) {
        void transitionMode("idle", { reason: "focus-loss" });
      }
    });
    const expandListener = listen("expand-main-window", () => {
      void transitionMode("full", { reason: "user" });
    });
    const toggleMainListener = listen("toggle-main-window", () => {
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      void transitionMode(effectiveMode === "full" ? "idle" : "full", { reason: "user" });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      if (modeRef.current === "peek" || modeRef.current === "actions" || modeRef.current === "full") {
        void transitionMode("idle", { reason: "keyboard" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", clearPointerOrigin);
    window.addEventListener("pointercancel", clearPointerOrigin);
    window.addEventListener("blur", clearPointerOrigin);

    return () => {
      void translationListener.then((unlisten) => unlisten()).catch(() => {});
      void focusListener.then((unlisten) => unlisten()).catch(() => {});
      void expandListener.then((unlisten) => unlisten()).catch(() => {});
      void toggleMainListener.then((unlisten) => unlisten()).catch(() => {});
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", clearPointerOrigin);
      window.removeEventListener("pointercancel", clearPointerOrigin);
      window.removeEventListener("blur", clearPointerOrigin);
      if (expectedActivityTimerRef.current) clearTimeout(expectedActivityTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [clearPointerOrigin, transitionCoordinator, transitionMode]);

  useEffect(() => {
    const lifetime = ++coordinatorLifetimeRef.current;
    return () => {
      queueMicrotask(() => {
        // Read the counter fresh: a StrictMode remount bumps it synchronously,
        // so a stale cleanup must NOT dispose the shared coordinator.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (coordinatorLifetimeRef.current === lifetime) {
          transitionCoordinator.dispose();
        }
      });
    };
  }, [transitionCoordinator]);

  return {
    presentation,
    phase,
    dockSide,
    busyAction,
    notice,
    shouldReduceMotion: shouldReduceMotion ?? false,
    collapseFull,
    expandFull,
    handleFullDragStart,
    handleFullDragEnd,
    handleFullWindowMoved,
    handlePinChange,
    runAction,
    handleCoreClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleIslandBlur,
  };
}
