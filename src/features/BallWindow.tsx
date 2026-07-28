import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  Clipboard,
  LoaderCircle,
  PanelTopOpen,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import VanishMark from "../components/brand/VanishMark";
import { useThemeSync } from "../hooks/useTheme";
import MainWindowApp from "./MainWindowApp";

const IDLE_WIDTH = 58;
const IDLE_HEIGHT = 38;
const ACTION_WIDTH = 278;
const ACTION_HEIGHT = 58;
const STATUS_WIDTH = 232;
const STATUS_HEIGHT = 48;
const FULL_WIDTH = 420;
const FULL_HEIGHT = 520;
const SCREEN_GUTTER = 8;
const MORPH_SETTLE_MS = 240;

const ISLAND_SPRING = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.72,
};

const CONTENT_EASE = [0.22, 1, 0.36, 1] as const;

type DockSide = "left" | "right";
type BallAction = "clipboard" | "screenshot" | "main";
type IslandMode = "idle" | "actions" | "status" | "full";
type IslandPhase = "working" | "done" | "error";

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
  if (mode === "actions") return { width: ACTION_WIDTH, height: ACTION_HEIGHT };
  if (mode === "status") return { width: STATUS_WIDTH, height: STATUS_HEIGHT };
  return { width: IDLE_WIDTH, height: IDLE_HEIGHT };
}

export default function BallWindow() {
  const [mode, setMode] = useState<IslandMode>("idle");
  const [phase, setPhase] = useState<IslandPhase>("working");
  const [dockSide, setDockSide] = useState<DockSide>("left");
  const [busyAction, setBusyAction] = useState<BallAction | null>(null);
  const [notice, setNotice] = useState("");
  const shouldReduceMotion = useReducedMotion();

  const modeRef = useRef<IslandMode>("idle");
  const dockSideRef = useRef<DockSide>("left");
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const geometryTransitionRef = useRef(false);
  const queuedModeRef = useRef<IslandMode | null>(null);
  const lastDragEndedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const anchorPositionRef = useRef<{ x: number; y: number } | null>(null);
  const idleOuterSizeRef = useRef<{ width: number; height: number } | null>(null);
  const expectingTranslationRef = useRef(false);
  const expectedActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullPinnedRef = useRef(false);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2200);
  }, []);

  const transitionMode: (target: IslandMode) => Promise<void> = useCallback(async (target) => {
    if (geometryTransitionRef.current) {
      queuedModeRef.current = target;
      return;
    }
    if (modeRef.current === target) return;

    geometryTransitionRef.current = true;
    const win = getCurrentWindow();
    const previousMode = modeRef.current;
    try {
      const scale = await win.scaleFactor();
      const idleWidthPixels = Math.round(IDLE_WIDTH * scale);
      const idleHeightPixels = Math.round(IDLE_HEIGHT * scale);

      if (previousMode === "full" && target !== "full") {
        await invoke("set_ball_window_material", { enabled: false });
      }

      if (target === "idle") {
        const previousAnchor = anchorPositionRef.current;
        const previousIdleOuterSize = idleOuterSizeRef.current;
        const anchoredX = previousAnchor
          ? dockSideRef.current === "left"
            ? previousAnchor.x + (previousIdleOuterSize?.width ?? idleWidthPixels)
            : previousAnchor.x
          : null;
        const anchoredCenterY = previousAnchor
          ? previousAnchor.y + Math.round((previousIdleOuterSize?.height ?? idleHeightPixels) / 2)
          : null;
        modeRef.current = "idle";
        setNotice("");
        setMode("idle");
        await wait(shouldReduceMotion ? 0 : MORPH_SETTLE_MS);
        await win.setSize(new PhysicalSize(idleWidthPixels, idleHeightPixels));
        const collapsedOuterSize = await win.outerSize();
        idleOuterSizeRef.current = collapsedOuterSize;
        if (anchoredX !== null && anchoredCenterY !== null) {
          const nextAnchor = {
            x: dockSideRef.current === "left"
              ? anchoredX - collapsedOuterSize.width
              : anchoredX,
            y: anchoredCenterY - Math.round(collapsedOuterSize.height / 2),
          };
          anchorPositionRef.current = nextAnchor;
          await win.setPosition(new PhysicalPosition(nextAnchor.x, nextAnchor.y));
          await invoke("save_ball_position", nextAnchor);
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
      const idleOuterHeight = idleOuterSize?.height ?? idleHeightPixels + chromeHeight;
      const { width: targetWidth, height: targetHeight } = getIslandDimensions(target);
      const targetWidthPixels = Math.round(targetWidth * scale);
      const targetHeightPixels = Math.round(targetHeight * scale);
      const estimatedOuterWidth = targetWidthPixels + chromeWidth;
      const gutterPixels = Math.round(SCREEN_GUTTER * scale);
      const monitorLeft = monitor?.position.x ?? 0;
      const monitorTop = monitor?.position.y ?? 0;
      const monitorRight = monitor
        ? monitor.position.x + monitor.size.width
        : anchor.x + estimatedOuterWidth;
      const monitorBottom = monitor
        ? monitor.position.y + monitor.size.height
        : anchor.y + targetHeightPixels;
      const coreLeft = dockSideRef.current === "left"
        ? anchor.x + idleOuterWidth - idleWidthPixels
        : anchor.x;
      const coreRight = coreLeft + idleWidthPixels;
      let side = dockSideRef.current;
      if (previousMode === "idle") {
        const canExpandLeft = coreRight - estimatedOuterWidth >= monitorLeft + gutterPixels;
        const canExpandRight = coreLeft + estimatedOuterWidth <= monitorRight - gutterPixels;
        side = canExpandLeft || !canExpandRight ? "left" : "right";
      }

      dockSideRef.current = side;
      setDockSide(side);
      anchorPositionRef.current = {
        x: side === "left" ? coreRight - idleOuterWidth : coreLeft,
        y: anchor.y,
      };

      const previousDimensions = getIslandDimensions(previousMode);
      const shrinksExistingIsland = previousMode !== "idle"
        && targetWidth <= previousDimensions.width
        && targetHeight <= previousDimensions.height;

      if (shrinksExistingIsland) {
        modeRef.current = target;
        setMode(target);
        await wait(shouldReduceMotion ? 0 : MORPH_SETTLE_MS);
      }

      await win.setSize(new PhysicalSize(targetWidthPixels, targetHeightPixels));
      const expandedOuterSize = await win.outerSize();
      const rawExpandedX = side === "left"
        ? coreRight - expandedOuterSize.width
        : coreLeft;
      const maxX = Math.max(
        monitorLeft + gutterPixels,
        monitorRight - expandedOuterSize.width - gutterPixels,
      );
      const expandedX = Math.min(Math.max(rawExpandedX, monitorLeft + gutterPixels), maxX);
      const centeredY = anchor.y + Math.round((idleOuterHeight - expandedOuterSize.height) / 2);
      const maxY = Math.max(
        monitorTop + gutterPixels,
        monitorBottom - expandedOuterSize.height - gutterPixels,
      );
      const expandedY = Math.min(Math.max(centeredY, monitorTop + gutterPixels), maxY);

      await win.setPosition(new PhysicalPosition(expandedX, expandedY));
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
        await win.setSize(new PhysicalSize(
          Math.round(IDLE_WIDTH * scale),
          Math.round(IDLE_HEIGHT * scale),
        ));
        const anchor = anchorPositionRef.current;
        if (anchor) await win.setPosition(new PhysicalPosition(anchor.x, anchor.y));
      } catch (rollbackError) {
        console.error("rollback translation island failed", rollbackError);
      }
    } finally {
      geometryTransitionRef.current = false;
      const queued = queuedModeRef.current;
      queuedModeRef.current = null;
      if (queued && queued !== modeRef.current) {
        window.setTimeout(() => void transitionMode(queued), 0);
      }
    }
  }, [shouldReduceMotion]);

  const toggleActions = useCallback(async () => {
    if (modeRef.current === "actions") await transitionMode("idle");
    else if (modeRef.current === "idle") await transitionMode("actions");
  }, [transitionMode]);

  const handleCoreClick = useCallback(async () => {
    if (performance.now() - lastDragEndedAtRef.current < 250) return;
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

  const runAction = useCallback(async (action: BallAction, command: string) => {
    if (action === "main") {
      setBusyAction(action);
      try {
        await expandFull();
      } finally {
        setBusyAction(null);
      }
      return;
    }

    const expectsTranslationState = action === "clipboard";
    if (expectsTranslationState) {
      expectingTranslationRef.current = true;
      if (expectedActivityTimerRef.current) clearTimeout(expectedActivityTimerRef.current);
    }
    setBusyAction(action);
    try {
      await invoke(command);
      if (expectsTranslationState) {
        if (expectingTranslationRef.current) {
          expectedActivityTimerRef.current = setTimeout(() => {
            expectingTranslationRef.current = false;
            expectedActivityTimerRef.current = null;
            void transitionMode("idle");
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
      setBusyAction(null);
    }
  }, [expandFull, showNotice, transitionMode]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (modeRef.current !== "idle" || geometryTransitionRef.current || event.button !== 0) return;
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const origin = pointerOriginRef.current;
    if (!origin || draggingRef.current || modeRef.current !== "idle" || geometryTransitionRef.current) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6) return;

    pointerOriginRef.current = null;
    draggingRef.current = true;
    lastDragEndedAtRef.current = performance.now();
    void (async () => {
      try {
        const win = getCurrentWindow();
        await win.startDragging();
        const endPosition = await win.outerPosition();
        const endOuterSize = await win.outerSize();
        anchorPositionRef.current = { x: endPosition.x, y: endPosition.y };
        idleOuterSizeRef.current = endOuterSize;
        lastDragEndedAtRef.current = performance.now();
        await invoke("save_ball_position", { x: endPosition.x, y: endPosition.y });
      } catch (error) {
        console.error("drag translation island failed", error);
      } finally {
        draggingRef.current = false;
      }
    })();
  }, []);

  const clearPointerOrigin = useCallback(() => {
    pointerOriginRef.current = null;
  }, []);

  const handleFullWindowMoved = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const position = await win.outerPosition();
      const outerSize = await win.outerSize();
      const innerSize = await win.innerSize();
      const idleOuterSize = idleOuterSizeRef.current;
      const idleOuterWidth = idleOuterSize?.width
        ?? Math.round(IDLE_WIDTH * scale) + outerSize.width - innerSize.width;
      const idleOuterHeight = idleOuterSize?.height
        ?? Math.round(IDLE_HEIGHT * scale) + outerSize.height - innerSize.height;
      const anchor = {
        x: dockSideRef.current === "left"
          ? position.x + outerSize.width - idleOuterWidth
          : position.x,
        y: position.y + Math.round((outerSize.height - idleOuterHeight) / 2),
      };
      anchorPositionRef.current = anchor;
      await invoke("save_ball_position", anchor);
    } catch (error) {
      console.error("save expanded translation island position failed", error);
    }
  }, []);

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
    const translationListener = listen<unknown>("translation-state", (event) => {
      const activity = normalizeTranslationActivity(event.payload);
      if (!activity) return;
      expectingTranslationRef.current = false;
      if (expectedActivityTimerRef.current) {
        clearTimeout(expectedActivityTimerRef.current);
        expectedActivityTimerRef.current = null;
      }
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);

      if (modeRef.current === "full") {
        if (activity !== "idle") setPhase(activity);
        return;
      }

      if (activity === "idle") {
        void transitionMode("idle");
        return;
      }

      setPhase(activity);
      void transitionMode("status");
      if (activity !== "working") {
        statusTimerRef.current = setTimeout(
          () => void transitionMode("idle"),
          activity === "done" ? 1250 : 1900,
        );
      }
    });
    const focusListener = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const shouldCollapseActions = modeRef.current === "actions"
        && !expectingTranslationRef.current;
      const shouldCollapseFull = modeRef.current === "full"
        && !fullPinnedRef.current;
      if (!focused
        && (shouldCollapseActions || shouldCollapseFull)
        && !geometryTransitionRef.current) {
        void transitionMode("idle");
      }
    });
    const expandListener = listen("expand-main-window", () => {
      void transitionMode("full");
    });
    const toggleMainListener = listen("toggle-main-window", () => {
      void transitionMode(modeRef.current === "full" ? "idle" : "full");
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      if (modeRef.current === "actions" || modeRef.current === "full") {
        void transitionMode("idle");
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      translationListener.then((unlisten) => unlisten());
      focusListener.then((unlisten) => unlisten());
      expandListener.then((unlisten) => unlisten());
      toggleMainListener.then((unlisten) => unlisten());
      window.removeEventListener("keydown", handleKeyDown);
      if (expectedActivityTimerRef.current) clearTimeout(expectedActivityTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [transitionMode]);

  const statusTitle = phase === "working"
    ? "正在翻译"
    : phase === "done"
      ? "翻译完成"
      : "翻译未完成";
  const statusDetail = phase === "working"
    ? "正在生成结果"
    : phase === "done"
      ? "结果已就绪"
      : "请检查连接";
  const contentOffset = dockSide === "left" ? 7 : -7;
  const layoutTransition = shouldReduceMotion ? { duration: 0 } : ISLAND_SPRING;
  const contentAnimate = shouldReduceMotion
    ? { opacity: 1, x: 0, scale: 1 }
    : {
        opacity: 1,
        x: 0,
        scale: 1,
        transition: { duration: 0.18, delay: 0.055, ease: CONTENT_EASE },
      };
  const contentExit = shouldReduceMotion
    ? { opacity: 0 }
    : {
        opacity: 0,
        x: contentOffset * 0.65,
        scale: 0.99,
        transition: { duration: 0.11, ease: CONTENT_EASE },
      };

  return (
    <aside
      className={`translation-island translation-island--${mode} translation-island--${dockSide} translation-island--${phase}`}
      aria-label="VanishTrans 快速工具"
    >
      <motion.div
        layout
        layoutDependency={mode}
        className="translation-island__surface"
        data-mode={mode}
        style={{ transformOrigin: dockSide === "left" ? "100% 50%" : "0% 50%" }}
        transition={{ layout: layoutTransition }}
      >
        <motion.div
          className="translation-island__full"
          aria-hidden={mode !== "full"}
          initial={false}
          animate={mode === "full"
            ? { opacity: 1, scale: 1, visibility: "visible" }
            : { opacity: 0, scale: 0.985, visibility: "hidden" }}
          transition={shouldReduceMotion
            ? { duration: 0 }
            : { duration: mode === "full" ? 0.22 : 0.12, delay: mode === "full" ? 0.06 : 0, ease: CONTENT_EASE }}
        >
          <MainWindowApp
            embedded
            onCollapse={collapseFull}
            onRequestExpand={expandFull}
            onWindowMoved={handleFullWindowMoved}
            onPinChange={handlePinChange}
          />
        </motion.div>

        <AnimatePresence initial={false} mode="popLayout">
          {mode === "actions" && (
            <motion.div
              layout="position"
              key="actions"
              className="translation-island__content translation-island__content--actions"
              initial={shouldReduceMotion ? false : { opacity: 0, x: contentOffset, scale: 0.985 }}
              animate={contentAnimate}
              exit={contentExit}
            >
              <AnimatePresence initial={false} mode="wait">
                {notice ? (
                  <motion.div
                    key="notice"
                    className="translation-island__notice"
                    role="status"
                    aria-live="polite"
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14, ease: CONTENT_EASE }}
                  >
                    <span className="translation-island__notice-icon" aria-hidden="true">
                      <TriangleAlert size={15} />
                    </span>
                    <span className="translation-island__notice-copy">
                      <strong>操作失败</strong>
                      <small>{notice}</small>
                    </span>
                  </motion.div>
                ) : (
                  <motion.nav
                    key="actions"
                    className="translation-island__actions"
                    aria-label="快速翻译操作"
                    initial={false}
                  >
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "clipboard" || undefined}
                      onClick={() => runAction("clipboard", "translate_clipboard_from_ball")}
                      title="翻译剪贴板"
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14, delay: 0.075, ease: CONTENT_EASE }}
                    >
                      {busyAction === "clipboard" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}
                      <span>剪贴板</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "screenshot" || undefined}
                      onClick={() => runAction("screenshot", "start_screenshot_from_ball")}
                      title="截图翻译"
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14, delay: 0.1, ease: CONTENT_EASE }}
                    >
                      {busyAction === "screenshot" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <ScanLine size={15} aria-hidden="true" />}
                      <span>截图</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "main" || undefined}
                      onClick={() => runAction("main", "")}
                      title="打开主窗口"
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14, delay: 0.125, ease: CONTENT_EASE }}
                    >
                      {busyAction === "main" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <PanelTopOpen size={15} aria-hidden="true" />}
                      <span>主界面</span>
                    </motion.button>
                  </motion.nav>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {mode === "status" && (
            <motion.div
              layout="position"
              key={`status-${phase}`}
              className="translation-island__content translation-island__content--status"
              role="status"
              aria-live="polite"
              initial={shouldReduceMotion ? false : { opacity: 0, x: contentOffset, scale: 0.985 }}
              animate={contentAnimate}
              exit={contentExit}
            >
              <span className="translation-island__state-icon" aria-hidden="true">
                {phase === "working" ? (
                  <span className="translation-island__activity">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : phase === "done" ? (
                  <Check size={16} />
                ) : (
                  <TriangleAlert size={15} />
                )}
              </span>
              <span className="translation-island__state-copy">
                <strong>{statusTitle}</strong>
                <small>{statusDetail}</small>
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {mode !== "full" && (
          <motion.button
            layout="position"
            transition={{ layout: layoutTransition }}
            type="button"
            className="translation-island__core"
            aria-expanded={mode === "actions"}
            aria-label={mode === "actions" ? "收起快速工具" : mode === "status" ? statusTitle : "展开快速工具"}
            title={mode === "idle" ? "快速工具" : mode === "actions" ? "收起" : statusTitle}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={clearPointerOrigin}
            onPointerCancel={clearPointerOrigin}
            onClick={handleCoreClick}
          >
            <VanishMark compact animated={false} decorative />
          </motion.button>
        )}
      </motion.div>
    </aside>
  );
}
