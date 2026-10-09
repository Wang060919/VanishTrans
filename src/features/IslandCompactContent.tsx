import { AnimatePresence, motion } from "framer-motion";
import { Check, Clipboard, LoaderCircle, ArrowUpRight, PanelTopOpen, ScanLine, TriangleAlert } from "lucide-react";
import { type IslandMode, type IslandPhase, type BallAction } from "./islandModel";

const CONTENT_EASE = [0.16, 1, 0.3, 1] as const;
interface Props {
  mode: IslandMode;
  phase: IslandPhase;
  instant: boolean;
  generation: number;
  contentWidth: number;
  notice: string;
  busyAction: BallAction | null;
  hasResult: boolean;
  onRunAction: (action: BallAction, command: string) => void;
  onCoreClick: () => void;
}

export default function IslandCompactContent({ mode, phase, instant, generation, contentWidth,
  notice, busyAction, hasResult, onRunAction, onCoreClick }: Props) {
  // Width morphs ride a spring so compact content pops open like the island shell.
  const contentMorph = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.9 };
  const statusTitle = phase === "working"
    ? "正在翻译"
    : phase === "done"
      ? "翻译完成"
      : "翻译遇到问题";
  const statusDetail = phase === "working"
    ? "完成后即可查看"
    : phase === "done"
      ? (hasResult ? "点击查看译文" : "结果已就绪")
      : "点击查看详情";
  const showsActions = mode === "peek" || mode === "actions";
  const contentAnimate = instant
    ? { opacity: 1, width: contentWidth }
    : {
        opacity: 1,
        width: contentWidth,
        transition: {
          width: contentMorph,
          opacity: { duration: 0.19, delay: 0.06, ease: CONTENT_EASE },
        },
      };
  const contentExit = instant
    ? { opacity: 0, width: 0 }
    : {
        opacity: 0,
        width: 0,
        transition: {
          width: contentMorph,
          opacity: { duration: 0.08, ease: CONTENT_EASE },
        },
      };
  return (
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
                    transition={instant ? { duration: 0 } : {
                      y: { type: "spring", stiffness: 460, damping: 28 },
                      scale: { type: "spring", stiffness: 460, damping: 28 },
                      opacity: { duration: 0.14, ease: CONTENT_EASE },
                    }}
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
                      title="翻译剪贴板内容"
                      onClick={() => onRunAction("clipboard", "translate_clipboard_from_ball")}
                      initial={instant ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={instant ? { duration: 0 } : {
                        delay: 0.07,
                        y: { type: "spring", stiffness: 520, damping: 30 },
                        opacity: { duration: 0.14, ease: CONTENT_EASE },
                      }}
                    >
                      {busyAction === "clipboard" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <Clipboard size={17} strokeWidth={2.2} aria-hidden="true" />}
                      <span>剪贴板</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "screenshot" || undefined}
                      title="截图翻译"
                      onClick={() => onRunAction("screenshot", "start_screenshot_from_ball")}
                      initial={instant ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={instant ? { duration: 0 } : {
                        delay: 0.09,
                        y: { type: "spring", stiffness: 520, damping: 30 },
                        opacity: { duration: 0.14, ease: CONTENT_EASE },
                      }}
                    >
                      {busyAction === "screenshot" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <ScanLine size={17} strokeWidth={2.2} aria-hidden="true" />}
                      <span>截图</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={busyAction !== null}
                      data-busy={busyAction === "main" || undefined}
                      title="打开主界面"
                      onClick={() => onRunAction("main", "")}
                      initial={instant ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={instant ? { duration: 0 } : {
                        delay: 0.11,
                        y: { type: "spring", stiffness: 520, damping: 30 },
                        opacity: { duration: 0.14, ease: CONTENT_EASE },
                      }}
                    >
                      {busyAction === "main" ? <LoaderCircle className="translation-island__action-loader" size={15} aria-hidden="true" /> : <PanelTopOpen size={17} strokeWidth={2.2} aria-hidden="true" />}
                      <span>主界面</span>
                    </motion.button>
                  </motion.nav>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {mode === "status" && (
            <motion.div
              key="status"
              className="translation-island__content translation-island__content--status"
              initial={instant
                ? false
                : { opacity: 0, width: 0 }}
              animate={contentAnimate}
              exit={contentExit}
            >
              <span className="translation-island__state-icon" aria-hidden="true">
                {phase === "working" ? (
                  <LoaderCircle className="translation-island__action-loader" size={17} />
                ) : phase === "done" ? (
                  <Check size={16} />
                ) : (
                  <TriangleAlert size={15} />
                )}
              </span>
              <span className="translation-island__state-copy" role="status" aria-live="polite">
                <strong>{statusTitle}</strong>
                <small>{statusDetail}</small>
              </span>
              {((phase === "done" && hasResult) || phase === "error") && (
                <button className="translation-island__status-open" type="button"
                  title={phase === "error" ? "查看翻译错误" : "查看翻译结果"}
                  aria-label={phase === "error" ? "查看翻译错误" : "查看翻译结果"} onClick={onCoreClick}>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

  );
}
