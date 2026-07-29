import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useThemeSync } from "../hooks/useTheme";
import MainWindowApp from "./MainWindowApp";
import TranslationIslandView, {
  type BallAction,
  type DockSide,
  type IslandMode,
  type IslandPhase,
} from "./TranslationIslandView";

const IDLE_WIDTH = 116;
const IDLE_HEIGHT = 42;
const ACTION_WIDTH = 296;
const ACTION_HEIGHT = 60;
const STATUS_WIDTH = 264;
const STATUS_HEIGHT = 52;
const FULL_WIDTH = 420;
const FULL_HEIGHT = 520;
const EDGE_GUTTER = 8;
const TOP_GUTTER = 0;
const TOP_SNAP_DISTANCE = 32;
const MORPH_SETTLE_MS = 340;

interface QueuedTransition {
  target: IslandMode;
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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function getIslandDimensions(mode: IslandMode) {
  if (mode === "full") return { width: FULL_WIDTH, height: FULL_HEIGHT };
  if (mode === "peek" || mode === "actions") return { width: ACTION_WIDTH, height: ACTION_HEIGHT };
  if (mode === "status") return { width: STATUS_WIDTH, height: STATUS_HEIGHT };
  return { width: IDLE_WIDTH, height: IDLE_HEIGHT };
}

function getExpandedX(
  side: DockSide,
  anchorX: number,
  idleOuterWidth: number,
  expandedOuterWidth: number,
) {
  if (side === "center") {
    return Math.round(anchorX + (idleOuterWidth - expandedOuterWidth) / 2);
  }
  return side === "left"
    ? anchorX + idleOuterWidth - expandedOuterWidth
    : anchorX;
}

function getIdleAnchorX(
  side: DockSide,
  expandedX: number,
  expandedOuterWidth: number,
  idleOuterWidth: number,
) {
  if (side === "center") {
    return Math.round(expandedX + (expandedOuterWidth - idleOuterWidth) / 2);
  }
  return side === "left"
    ? expandedX + expandedOuterWidth - idleOuterWidth
    : expandedX;
}

function chooseDockSide(
  anchorX: number,
  idleOuterWidth: number,
  preferredOuterWidth: number,
  monitorLeft: number,
  monitorRight: number,
  gutter: number,
): DockSide {
  const minX = monitorLeft + gutter;
  const maxRight = monitorRight - gutter;
  const centeredX = getExpandedX("center", anchorX, idleOuterWidth, preferredOuterWidth);
  if (centeredX >= minX && centeredX + preferredOuterWidth <= maxRight) {
    return "center";
  }

  const leftX = getExpandedX("left", anchorX, idleOuterWidth, preferredOuterWidth);
  const canExpandLeft = leftX >= minX;
  const canExpandRight = anchorX + preferredOuterWidth <= maxRight;
  if (canExpandLeft || !canExpandRight) return "left";
  return "right";
}

async function setBallWindowBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}, durationMs = 0) {
  await invoke("set_ball_window_bounds", durationMs > 0
    ? { ...bounds, durationMs }
    : bounds);
}

async function saveBallPosition(
  position: { x: number; y: number },
  reposition = true,
) {
  const saved = await invoke<[number, number] | undefined>("save_ball_position", {
    ...position,
    reposition,
  });
  return Array.isArray(saved) && saved.length === 2
    ? { x: saved[0], y: saved[1] }
    : position;
}

export default function BallWindow() {
  const [mode, setMode] = useState<IslandMode>("idle");
  const [phase, setPhase] = useState<IslandPhase>("working");
  const [dockSide, setDockSide] = useState<DockSide>("center");
  const [busyAction, setBusyAction] = useState<BallAction | null>(null);
  const [notice, setNotice] = useState("");
  const shouldReduceMotion = useReducedMotion();

  const modeRef = useRef<IslandMode>("idle");
  const dockSideRef = useRef<DockSide>("center");
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pointerCaptureTargetRef = useRef<Element | null>(null);
  const draggingRef = useRef(false);
  const geometryTransitionRef = useRef(false);
  const transitionTargetRef = useRef<IslandMode | null>(null);
  const queuedTransitionRef = useRef<QueuedTransition | null>(null);
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

  const transitionMode: (target: IslandMode) => Promise<void> = useCallback(async (target) => {
    if (target === "full" && statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }

    if (draggingRef.current) {
      queuedTransitionRef.current = { target };
      return;
    }

    if (geometryTransitionRef.current) {
      queuedTransitionRef.current = { target };
      return;
    }
    if (modeRef.current === target) return;

    geometryTransitionRef.current = true;
    transitionTargetRef.current = target;
    const win = getCurrentWindow();
    const previousMode = modeRef.current;
    try {
      const scale = await win.scaleFactor();
      const idleWidthPixels = Math.round(IDLE_WIDTH * scale);
      const idleHeightPixels = Math.round(IDLE_HEIGHT * scale);
      const previousDimensions = getIslandDimensions(previousMode);
      const targetDimensions = getIslandDimensions(target);

      if (previousDimensions.width === targetDimensions.width
        && previousDimensions.height === targetDimensions.height
        && previousMode !== "full"
        && target !== "full") {
        modeRef.current = target;
        setMode(target);
        if (target === "actions") await win.setFocus();
        return;
      }

      if (previousMode === "full" && target !== "full") {
        await invoke("set_ball_window_material", { enabled: false });
      }

      if (target === "idle") {
        const nextAnchor = anchorPositionRef.current;
        modeRef.current = "idle";
        noticeRef.current = "";
        setNotice("");
        setMode("idle");
        await wait(shouldReduceMotion ? 0 : MORPH_SETTLE_MS);
        if (nextAnchor) {
          await setBallWindowBounds({
            x: nextAnchor.x,
            y: nextAnchor.y,
            width: idleWidthPixels,
            height: idleHeightPixels,
          });
          idleOuterSizeRef.current = await win.outerSize();
          anchorPositionRef.current = await saveBallPosition(nextAnchor, false);
        }
        return;
      }

      const currentPosition = await win.outerPosition();
      const currentOuterSize = await win.outerSize();
      const currentInnerSize = await win.innerSize();
      const monitor = await currentMonitor();
      const chromeWidth = currentOuterSize.width - currentInnerSize.width;
      const chromeHeight = currentOuterSize.height - currentInnerSize.height;

      if (previousMode === "idle" || !anchorPositionRef.current) {
        anchorPositionRef.current = { x: currentPosition.x, y: currentPosition.y };
        idleOuterSizeRef.current = currentOuterSize;
      }
      const anchor = anchorPositionRef.current ?? { x: currentPosition.x, y: currentPosition.y };
      const idleOuterSize = idleOuterSizeRef.current;
      const idleOuterWidth = idleOuterSize?.width ?? idleWidthPixels + chromeWidth;
      const { width: targetWidth, height: targetHeight } = targetDimensions;
      const targetWidthPixels = Math.round(targetWidth * scale);
      const targetHeightPixels = Math.round(targetHeight * scale);
      const estimatedOuterWidth = targetWidthPixels + chromeWidth;
      const estimatedOuterHeight = targetHeightPixels + chromeHeight;
      const edgeGutterPixels = Math.round(EDGE_GUTTER * scale);
      const topGutterPixels = Math.round(TOP_GUTTER * scale);
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
      // The resized transparent HWND can paint immediately, so its CSS anchor
      // must be committed before the native bounds change becomes visible.
      flushSync(() => setDockSide(side));

      const shrinksExistingIsland = previousMode !== "idle"
        && targetWidth <= previousDimensions.width
        && targetHeight <= previousDimensions.height
        && (targetWidth < previousDimensions.width || targetHeight < previousDimensions.height);

      if (shrinksExistingIsland) {
        modeRef.current = target;
        setMode(target);
        await wait(shouldReduceMotion ? 0 : MORPH_SETTLE_MS);
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

      await setBallWindowBounds({
        x: expandedX,
        y: expandedY,
        width: targetWidthPixels,
        height: targetHeightPixels,
      });
      anchorPositionRef.current = {
        x: getIdleAnchorX(side, expandedX, estimatedOuterWidth, idleOuterWidth),
        y: expandedY,
      };
      if (!shrinksExistingIsland) {
        modeRef.current = target;
        setMode(target);
      }
      if (target === "actions" || target === "full") await win.setFocus();
      if (target === "full") {
        await wait(shouldReduceMotion ? 0 : MORPH_SETTLE_MS);
        await invoke("set_ball_window_material", { enabled: true });
      }
    } catch (error) {
      console.error("transition translation island failed", error);
      if (previousMode === "full" || target === "full") {
        await invoke("set_ball_window_material", { enabled: false }).catch(() => {});
      }
      modeRef.current = "idle";
      setMode("idle");
      try {
        const scale = await win.scaleFactor();
        const anchor = anchorPositionRef.current;
        if (anchor) {
          await setBallWindowBounds({
            x: anchor.x,
            y: anchor.y,
            width: Math.round(IDLE_WIDTH * scale),
            height: Math.round(IDLE_HEIGHT * scale),
          });
        }
      } catch (rollbackError) {
        console.error("rollback translation island failed", rollbackError);
      }
    } finally {
      geometryTransitionRef.current = false;
      transitionTargetRef.current = null;
      const queued = queuedTransitionRef.current;
      queuedTransitionRef.current = null;
      if (queued && queued.target !== modeRef.current) {
        void transitionMode(queued.target);
      }
    }
  }, [shouldReduceMotion]);

  const scheduleStatusCollapse = useCallback((statusPhase: IslandPhase) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
    if (statusPhase === "working") return;
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      const effectiveMode = queuedTransitionRef.current?.target
        ?? transitionTargetRef.current
        ?? modeRef.current;
      if (effectiveMode === "status") void transitionMode("idle");
    }, statusPhase === "done" ? 1250 : 1900);
  }, [transitionMode]);

  const handleIslandBlur = useCallback((event: React.FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (modeRef.current === "actions"
      && !geometryTransitionRef.current
      && !draggingRef.current
      && busyActionRef.current === null
      && !expectingTranslationRef.current
      && !noticeRef.current) {
      void transitionMode("idle");
    }
  }, [transitionMode]);

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
      await invoke(command);
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
      const message = String(error).replace(/^Error:\s*/, "");
      showNotice(message || "操作失败，请重试");
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  }, [expandFull, showNotice, transitionMode]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const modeIsDraggable = modeRef.current !== "full";
    if (!modeIsDraggable || geometryTransitionRef.current || event.button !== 0) return;
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
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const origin = pointerOriginRef.current;
    const dragMode = modeRef.current;
    const modeIsDraggable = dragMode !== "full";
    if (!origin || draggingRef.current || !modeIsDraggable || geometryTransitionRef.current) return;
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

        if (dragMode === "peek" || dragMode === "actions" || dragMode === "status") {
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
        console.error("drag translation island failed", error);
      } finally {
        draggingRef.current = false;
        const queued = queuedTransitionRef.current;
        queuedTransitionRef.current = null;
        if (queued && queued.target !== modeRef.current) {
          void transitionMode(queued.target);
        } else if (dragMode === "status" && modeRef.current === "status") {
          scheduleStatusCollapse(phaseRef.current);
        }
      }
    })();
  }, [scheduleStatusCollapse, transitionMode]);

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
      const edgeGutterPixels = Math.round(EDGE_GUTTER * scale);
      const topGutterPixels = Math.round(TOP_GUTTER * scale);
      const snapDistancePixels = Math.round(TOP_SNAP_DISTANCE * scale);
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
      console.error("save expanded translation island position failed", error);
    }
  }, []);

  const handleFullDragStart = useCallback(() => {
    if (modeRef.current !== "full" || geometryTransitionRef.current || draggingRef.current) {
      return false;
    }
    draggingRef.current = true;
    return true;
  }, []);

  const handleFullDragEnd = useCallback(() => {
    draggingRef.current = false;
    const queued = queuedTransitionRef.current;
    queuedTransitionRef.current = null;
    if (queued && queued.target !== modeRef.current) {
      void transitionMode(queued.target);
    }
  }, [transitionMode]);

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
        || transitionTargetRef.current === "full"
        || queuedTransitionRef.current?.target === "full";
      if (fullIsActiveOrPending) {
        if (activity !== "idle") {
          phaseRef.current = activity;
          setPhase(activity);
        }
        return;
      }

      if (activity === "idle") {
        void transitionMode("idle");
        return;
      }

      phaseRef.current = activity;
      setPhase(activity);
      void transitionMode("status");
    });
    const focusListener = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const effectiveMode = queuedTransitionRef.current?.target
        ?? transitionTargetRef.current
        ?? modeRef.current;
      const shouldCollapseActions = (effectiveMode === "peek" || effectiveMode === "actions")
        && !expectingTranslationRef.current;
      const shouldCollapseFull = effectiveMode === "full"
        && !fullPinnedRef.current;
      if (!focused && (shouldCollapseActions || shouldCollapseFull)) {
        void transitionMode("idle");
      }
    });
    const expandListener = listen("expand-main-window", () => {
      void transitionMode("full");
    });
    const toggleMainListener = listen("toggle-main-window", () => {
      const effectiveMode = queuedTransitionRef.current?.target
        ?? transitionTargetRef.current
        ?? modeRef.current;
      void transitionMode(effectiveMode === "full" ? "idle" : "full");
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      if (modeRef.current === "peek" || modeRef.current === "actions" || modeRef.current === "full") {
        void transitionMode("idle");
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
  }, [clearPointerOrigin, transitionMode]);

  return (
    <TranslationIslandView
      mode={mode}
      phase={phase}
      dockSide={dockSide}
      busyAction={busyAction}
      notice={notice}
      shouldReduceMotion={shouldReduceMotion ?? false}
      fullContent={(
        <MainWindowApp
          embedded
          onCollapse={collapseFull}
          onRequestExpand={expandFull}
          onWindowDragStart={handleFullDragStart}
          onWindowDragEnd={handleFullDragEnd}
          onWindowMoved={handleFullWindowMoved}
          onPinChange={handlePinChange}
        />
      )}
      onRunAction={(action, command) => void runAction(action, command)}
      onCoreClick={() => void handleCoreClick()}
      onCorePointerDown={handlePointerDown}
      onCorePointerMove={handlePointerMove}
      onCorePointerUp={handlePointerEnd}
      onCorePointerCancel={handlePointerEnd}
      onIslandBlur={handleIslandBlur}
    />
  );
}
