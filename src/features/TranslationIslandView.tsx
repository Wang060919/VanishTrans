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
  FocusEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react";
import { useEffect, useState } from "react";
import VanishMark from "../components/brand/VanishMark";

export type DockSide = "left" | "center" | "right";
export type BallAction = "clipboard" | "screenshot" | "main";
export type IslandMode = "idle" | "peek" | "actions" | "status" | "full";
export type IslandPhase = "working" | "done" | "error";

export const ISLAND_MORPH = {
  type: "tween" as const,
  duration: 0.34,
  ease: [0.25, 1, 0.5, 1] as const,
};

const CONTENT_EASE = [0.22, 1, 0.36, 1] as const;
const CORE_WIDTH = 58;
const MORPH_SETTLE_MS = ISLAND_MORPH.duration * 1000;

const ISLAND_GEOMETRY: Record<IslandMode, {
  width: number;
  height: number;
  borderRadius: number;
}> = {
  idle: { width: 116, height: 42, borderRadius: 21 },
  peek: { width: 296, height: 60, borderRadius: 30 },
  actions: { width: 296, height: 60, borderRadius: 30 },
  status: { width: 264, height: 52, borderRadius: 26 },
  full: { width: 420, height: 520, borderRadius: 16 },
};

interface TranslationIslandViewProps {
  mode: IslandMode;
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
  mode,
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
  const [idleWordmarkReady, setIdleWordmarkReady] = useState(mode === "idle");

  useEffect(() => {
    if (mode !== "idle") {
      setIdleWordmarkReady(false);
      return;
    }
    if (shouldReduceMotion) {
      setIdleWordmarkReady(true);
      return;
    }

    const timer = window.setTimeout(() => setIdleWordmarkReady(true), MORPH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [mode, shouldReduceMotion]);

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
  const geometry = ISLAND_GEOMETRY[mode];
  const contentWidth = Math.max(0, geometry.width - CORE_WIDTH);
  const layoutTransition = shouldReduceMotion ? { duration: 0 } : ISLAND_MORPH;
  const contentAnimate = shouldReduceMotion
    ? { opacity: 1, width: contentWidth }
    : {
        opacity: 1,
        width: contentWidth,
        transition: {
          width: ISLAND_MORPH,
          opacity: { duration: 0.19, delay: 0.06, ease: CONTENT_EASE },
        },
      };
  const contentExit = shouldReduceMotion
    ? { opacity: 0, width: 0 }
    : {
        opacity: 0,
        width: 0,
        transition: {
          width: ISLAND_MORPH,
          opacity: { duration: 0.08, ease: CONTENT_EASE },
        },
      };

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
      className={`translation-island translation-island--${mode} translation-island--${dockSide} translation-island--${phase}`}
      aria-label="VanishTrans 快速工具"
      onPointerDown={onCorePointerDown}
      onPointerMove={onCorePointerMove}
      onPointerUp={onCorePointerUp}
      onPointerCancel={onCorePointerCancel}
      onLostPointerCapture={onCorePointerCancel}
      onBlurCapture={onIslandBlur}
    >
      <motion.div
        className="translation-island__surface"
        data-mode={mode}
        initial={false}
        animate={{
          width: geometry.width,
          height: geometry.height,
          borderRadius: geometry.borderRadius,
        }}
        style={{
          transformOrigin: dockSide === "center"
            ? "50% 0%"
            : dockSide === "left"
              ? "100% 0%"
              : "0% 0%",
        }}
        transition={layoutTransition}
      >
        <motion.div
          className="translation-island__full"
          aria-hidden={mode !== "full"}
          initial={false}
          animate={mode === "full"
            ? { opacity: 1, scale: 1, visibility: "visible" }
            : { opacity: 0, scale: 0.982, visibility: "hidden" }}
          transition={shouldReduceMotion
            ? { duration: 0 }
            : {
                duration: mode === "full" ? 0.22 : 0.1,
                delay: mode === "full" ? 0.04 : 0,
                ease: CONTENT_EASE,
              }}
        >
          {fullContent}
        </motion.div>

        <AnimatePresence initial={false} mode="popLayout">
          {showsActions && (
            <motion.div
              key="actions"
              className="translation-island__content translation-island__content--actions"
              initial={shouldReduceMotion
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
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 3, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -2, scale: 0.99 }}
                    transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16, ease: CONTENT_EASE }}
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
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16, delay: 0.07, ease: CONTENT_EASE }}
                    >
                      {busyAction === "clipboard" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}
                      <span>剪贴板</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "screenshot" || undefined}
                      onClick={() => onRunAction("screenshot", "start_screenshot_from_ball")}
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16, delay: 0.09, ease: CONTENT_EASE }}
                    >
                      {busyAction === "screenshot" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <ScanLine size={15} aria-hidden="true" />}
                      <span>截图</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "main" || undefined}
                      onClick={() => onRunAction("main", "")}
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16, delay: 0.11, ease: CONTENT_EASE }}
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
              initial={shouldReduceMotion
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
              compact={mode !== "idle" || (!shouldReduceMotion && !idleWordmarkReady)}
              animated={false}
              decorative
            />
          </motion.button>
        )}
      </motion.div>
    </aside>
  );
}
