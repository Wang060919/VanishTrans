import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { Clipboard, PanelTopOpen, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import VanishMark from "../components/brand/VanishMark";

const ORB_SIZE = 52;
const DOCK_WIDTH = 278;
const DOCK_HEIGHT = 72;
const SCREEN_GUTTER = 8;

type DockSide = "left" | "right";
type BallAction = "clipboard" | "screenshot" | "main";

export default function BallWindow() {
  const [expanded, setExpanded] = useState(false);
  const [dockSide, setDockSide] = useState<DockSide>("left");
  const [translating, setTranslating] = useState(false);
  const [busyAction, setBusyAction] = useState<BallAction | null>(null);
  const [notice, setNotice] = useState("");

  const expandedRef = useRef(false);
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const geometryTransitionRef = useRef(false);
  const lastDragEndedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const anchorPositionRef = useRef<{ x: number; y: number } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2200);
  }, []);

  const collapseDock = useCallback(async () => {
    if (!expandedRef.current || geometryTransitionRef.current) return;
    geometryTransitionRef.current = true;
    expandedRef.current = false;
    setExpanded(false);
    setNotice("");

    try {
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const collapsedPixels = Math.round(ORB_SIZE * scale);
      await win.setSize(new PhysicalSize(collapsedPixels, collapsedPixels));
      const anchor = anchorPositionRef.current;
      if (anchor) {
        await win.setPosition(new PhysicalPosition(anchor.x, anchor.y));
      }
    } catch (error) {
      console.error("collapse translation dock failed", error);
    } finally {
      geometryTransitionRef.current = false;
    }
  }, []);

  const expandDock = useCallback(async () => {
    if (geometryTransitionRef.current) return;
    geometryTransitionRef.current = true;
    const win = getCurrentWindow();
    try {
      const anchor = await win.outerPosition();
      const collapsedOuterSize = await win.outerSize();
      const collapsedInnerSize = await win.innerSize();
      const monitor = await currentMonitor();
      const scale = await win.scaleFactor();
      const orbPixels = Math.round(ORB_SIZE * scale);
      const widthPixels = Math.round(DOCK_WIDTH * scale);
      const heightPixels = Math.round(DOCK_HEIGHT * scale);
      const gutterPixels = Math.round(SCREEN_GUTTER * scale);
      const chromeWidth = collapsedOuterSize.width - collapsedInnerSize.width;
      const estimatedOuterWidth = widthPixels + chromeWidth;
      const monitorLeft = monitor?.position.x ?? 0;
      const monitorTop = monitor?.position.y ?? 0;
      const monitorRight = monitor
        ? monitor.position.x + monitor.size.width
        : anchor.x + estimatedOuterWidth;
      const monitorBottom = monitor
        ? monitor.position.y + monitor.size.height
        : anchor.y + heightPixels;

      const coreLeft = dockSide === "left"
        ? anchor.x + collapsedOuterSize.width - orbPixels
        : anchor.x;
      const coreRight = coreLeft + orbPixels;
      const canExpandLeft = coreRight - estimatedOuterWidth >= monitorLeft + gutterPixels;
      const side: DockSide = canExpandLeft ? "left" : "right";

      expandedRef.current = true;
      setDockSide(side);
      setExpanded(true);
      await win.setSize(new PhysicalSize(widthPixels, heightPixels));

      const expandedOuterSize = await win.outerSize();
      const expandedX = side === "left"
        ? coreRight - expandedOuterSize.width
        : coreLeft;
      const centeredY = anchor.y
        + Math.round((collapsedOuterSize.height - expandedOuterSize.height) / 2);
      const expandedY = Math.min(
        Math.max(centeredY, monitorTop + gutterPixels),
        monitorBottom - expandedOuterSize.height - gutterPixels,
      );

      anchorPositionRef.current = {
        x: side === "left" ? coreRight - collapsedOuterSize.width : coreLeft,
        y: anchor.y,
      };
      await win.setPosition(new PhysicalPosition(expandedX, expandedY));
      await win.setFocus();
    } catch (error) {
      expandedRef.current = false;
      setExpanded(false);
      console.error("expand translation dock failed", error);
      try {
        const scale = await win.scaleFactor();
        const collapsedPixels = Math.round(ORB_SIZE * scale);
        await win.setSize(new PhysicalSize(collapsedPixels, collapsedPixels));
        const anchor = anchorPositionRef.current;
        if (anchor) {
          await win.setPosition(new PhysicalPosition(anchor.x, anchor.y));
        }
      } catch (rollbackError) {
        console.error("rollback translation dock failed", rollbackError);
      }
    } finally {
      geometryTransitionRef.current = false;
    }
  }, [dockSide]);

  const toggleDock = useCallback(async () => {
    if (expandedRef.current) await collapseDock();
    else await expandDock();
  }, [collapseDock, expandDock]);

  const handleCoreClick = useCallback(async () => {
    if (performance.now() - lastDragEndedAtRef.current < 250) return;
    await toggleDock();
  }, [toggleDock]);

  const runAction = useCallback(async (action: BallAction, command: string) => {
    setBusyAction(action);
    try {
      await invoke(command);
      await collapseDock();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/, "");
      showNotice(message || "操作失败，请重试");
    } finally {
      setBusyAction(null);
    }
  }, [collapseDock, showNotice]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (expandedRef.current || geometryTransitionRef.current || event.button !== 0) return;
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const origin = pointerOriginRef.current;
    if (!origin || draggingRef.current || expandedRef.current || geometryTransitionRef.current) return;

    const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (distance < 6) return;

    pointerOriginRef.current = null;
    draggingRef.current = true;
    lastDragEndedAtRef.current = performance.now();

    void (async () => {
      try {
        const win = getCurrentWindow();
        await win.startDragging();
        const endPosition = await win.outerPosition();
        lastDragEndedAtRef.current = performance.now();
        await invoke("save_ball_position", { x: endPosition.x, y: endPosition.y });
      } catch (error) {
        console.error("drag translation ball failed", error);
      } finally {
        draggingRef.current = false;
      }
    })();
  }, []);

  const clearPointerOrigin = useCallback(() => {
    pointerOriginRef.current = null;
  }, []);

  useEffect(() => {
    document.body.classList.add("ball-window-body");
    return () => document.body.classList.remove("ball-window-body");
  }, []);

  useEffect(() => {
    const translationListener = listen<boolean>("translation-state", (event) => {
      setTranslating(Boolean(event.payload));
    });
    const focusListener = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && expandedRef.current && !geometryTransitionRef.current) void collapseDock();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void collapseDock();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      translationListener.then((unlisten) => unlisten());
      focusListener.then((unlisten) => unlisten());
      window.removeEventListener("keydown", handleKeyDown);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [collapseDock]);

  return (
    <aside
      className={`translation-orb ${expanded ? "translation-orb--expanded" : ""} translation-orb--${dockSide}`}
      aria-label="VanishTrans 快速工具"
    >
      {expanded && (
        <div className="translation-orb__dock">
          {notice ? (
            <div className="translation-orb__notice" role="status" aria-live="polite">
              <span>无法执行</span>
              <strong>{notice}</strong>
            </div>
          ) : (
            <nav className="translation-orb__actions" aria-label="快速翻译操作">
              <button
                type="button"
                disabled={busyAction !== null}
                data-busy={busyAction === "clipboard" || undefined}
                onClick={() => runAction("clipboard", "translate_clipboard_from_ball")}
                title="翻译当前剪贴板文本"
              >
                <Clipboard size={17} aria-hidden="true" />
                <span>剪贴板</span>
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                data-busy={busyAction === "screenshot" || undefined}
                onClick={() => runAction("screenshot", "start_screenshot_from_ball")}
                title="截取屏幕区域并翻译"
              >
                <ScanLine size={17} aria-hidden="true" />
                <span>截图</span>
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                data-busy={busyAction === "main" || undefined}
                onClick={() => runAction("main", "show_main_window")}
                title="打开完整翻译界面"
              >
                <PanelTopOpen size={17} aria-hidden="true" />
                <span>主界面</span>
              </button>
            </nav>
          )}
        </div>
      )}

      <button
        type="button"
        className="translation-orb__core"
        data-translating={translating || undefined}
        aria-expanded={expanded}
        aria-label={expanded ? "收起快速工具" : "展开快速工具"}
        title={translating ? "正在翻译" : "点击展开，拖动改变位置"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearPointerOrigin}
        onPointerCancel={clearPointerOrigin}
        onClick={handleCoreClick}
      >
        <span className="translation-orb__signal" aria-hidden="true" />
        <VanishMark compact animated={false} decorative />
      </button>
    </aside>
  );
}
