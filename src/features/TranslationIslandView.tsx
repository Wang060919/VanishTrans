import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Clipboard,
  LoaderCircle,
  PanelTopOpen,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import type {
  CSSProperties,
  FocusEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react";
import { useEffect, useState } from "react";
import VanishMark from "../components/brand/VanishMark";
import {
  getIslandGeometry,
  ISLAND_TIMING,
  type BallAction,
  type DockSide,
  type IslandPhase,
  type IslandPresentation,
} from "./islandModel";

export type {
  BallAction,
  DockSide,
  IslandMode,
  IslandPhase,
  IslandPresentation,
} from "./islandModel";

const CONTENT_EASE = [0.22, 1, 0.36, 1] as const;
const CORE_WIDTH = 58;
const CONTENT_MORPH = {
  type: "tween" as const,
  duration: ISLAND_TIMING.surfaceMs / 1000,
  ease: CONTENT_EASE,
};

interface TranslationIslandViewProps {
  presentation: IslandPresentation;
  phase: IslandPhase;
  dockSide: DockSide;
  busyAction: BallAction | null;
  notice: string;
  shouldReduceMotion: boolean;
  fullContent: ReactNode;
  onRunAction: (action: BallAction, command: string) => void;
  onCoreClick: () => void;
  onCorePointerDown: PointerEventHandler<HTMLElement>;
  onCorePointerMove: PointerEventHandler<HTMLElement>;
  onCorePointerUp: PointerEventHandler<HTMLElement>;
  onCorePointerCancel: PointerEventHandler<HTMLElement>;
  onIslandBlur: FocusEventHandler<HTMLElement>;
}

export default function TranslationIslandView({
  presentation,
  phase,
  dockSide,
  busyAction,
  notice,
  shouldReduceMotion,
  fullContent,
  onRunAction,
  onCoreClick,
  onCorePointerDown,
  onCorePointerMove,
  onCorePointerUp,
  onCorePointerCancel,
  onIslandBlur,
}: TranslationIslandViewProps) {
  const { mode, motion: motionMode, phase: visualPhase, generation } = presentation;
  const instant = shouldReduceMotion || motionMode === "instant";
  const fullVisible = mode === "full" && visualPhase === "stable";
  const [idleWordmarkReady, setIdleWordmarkReady] = useState(mode === "idle");

  useEffect(() => {
    if (mode !== "idle") {
      setIdleWordmarkReady(false);
      return;
    }
    if (instant) {
      setIdleWordmarkReady(true);
      return;
    }

    const timer = window.setTimeout(
      () => setIdleWordmarkReady(true),
      ISLAND_TIMING.surfaceMs,
    );
    return () => window.clearTimeout(timer);
  }, [instant, mode]);

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
  const showsActions = mode === "peek" || mode === "actions";
  const geometry = getIslandGeometry(mode);
  const contentWidth = Math.max(0, geometry.width - CORE_WIDTH);
  const contentAnimate = instant
    ? { opacity: 1, width: contentWidth }
    : {
        opacity: 1,
        width: contentWidth,
        transition: {
          width: CONTENT_MORPH,
          opacity: { duration: 0.19, delay: 0.06, ease: CONTENT_EASE },
        },
      };
  const contentExit = instant
    ? { opacity: 0, width: 0 }
    : {
        opacity: 0,
        width: 0,
        transition: {
          width: CONTENT_MORPH,
          opacity: { duration: 0.08, ease: CONTENT_EASE },
        },
      };
  const islandStyle = {
    "--island-width": `${geometry.width}px`,
    "--island-height": `${geometry.height}px`,
    "--island-radius": `${geometry.borderRadius}px`,
  } as CSSProperties;
  const islandClassName = [
    "translation-island",
    `translation-island--${mode}`,
    `translation-island--${dockSide}`,
    `translation-island--${phase}`,
    `translation-island--${visualPhase}`,
    instant && "translation-island--instant",
  ].filter(Boolean).join(" ");

  const coreLabel = mode === "idle"
    ? "展开快速工具"
    : mode === "peek"
      ? "固定快速工具"
      : mode === "actions"
        ? "收起快速工具"
        : phase === "working"
          ? statusTitle
          : phase === "done"
            ? "收起翻译完成提示"
            : "收起翻译错误提示";

  return (
    <aside
      className={islandClassName}
      style={islandStyle}
      aria-label="VanishTrans 快速工具"
      onPointerDown={onCorePointerDown}
      onPointerMove={onCorePointerMove}
      onPointerUp={onCorePointerUp}
      onPointerCancel={onCorePointerCancel}
      onLostPointerCapture={onCorePointerCancel}
      onBlurCapture={onIslandBlur}
    >
      <div
        className="translation-island__surface"
        data-mode={mode}
        data-transition-generation={generation}
        style={{
          transformOrigin: dockSide === "center"
            ? "50% 0%"
            : dockSide === "left"
              ? "100% 0%"
              : "0% 0%",
        }}
      >
        <div
          className="translation-island__full"
          aria-hidden={!fullVisible}
        >
          {fullContent}
        </div>

        <AnimatePresence
          key={instant ? `instant-${generation}` : "animated"}
          initial={false}
          mode="popLayout"
        >
          {showsActions && (
            <motion.div
              key="actions"
              className="translation-island__content translation-island__content--actions"
              initial={instant
                ? false
                : { opacity: 0, width: 0 }}
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
                    initial={instant ? false : { opacity: 0, y: 3, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -2, scale: 0.99 }}
                    transition={instant ? { duration: 0 } : { duration: 0.16, ease: CONTENT_EASE }}
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
                      onClick={() => onRunAction("clipboard", "translate_clipboard_from_ball")}
                      initial={instant ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={instant ? { duration: 0 } : { duration: 0.16, delay: 0.07, ease: CONTENT_EASE }}
                    >
                      {busyAction === "clipboard" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}
                      <span>剪贴板</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "screenshot" || undefined}
                      onClick={() => onRunAction("screenshot", "start_screenshot_from_ball")}
                      initial={instant ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={instant ? { duration: 0 } : { duration: 0.16, delay: 0.09, ease: CONTENT_EASE }}
                    >
                      {busyAction === "screenshot" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <ScanLine size={15} aria-hidden="true" />}
                      <span>截图</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "main" || undefined}
                      onClick={() => onRunAction("main", "")}
                      initial={instant ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={instant ? { duration: 0 } : { duration: 0.16, delay: 0.11, ease: CONTENT_EASE }}
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
              key={`status-${phase}`}
              className="translation-island__content translation-island__content--status"
              role="status"
              aria-live="polite"
              initial={instant
                ? false
                : { opacity: 0, width: 0 }}
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
            type="button"
            className="translation-island__core"
            disabled={mode === "status" && phase === "working"}
            aria-expanded={showsActions}
            aria-label={coreLabel}
            onClick={onCoreClick}
          >
            <VanishMark
              compact={mode !== "idle" || (!instant && !idleWordmarkReady)}
              animated={false}
              decorative
            />
          </motion.button>
        )}
      </div>
    </aside>
  );
}
