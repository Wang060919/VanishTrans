import { motion, type Transition } from "framer-motion";
import IslandCompactContent from "./IslandCompactContent";
import type {
  CSSProperties,
  FocusEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react";
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

interface TranslationIslandViewProps {
  presentation: IslandPresentation;
  phase: IslandPhase;
  dockSide: DockSide;
  busyAction: BallAction | null;
  notice: string;
  shouldReduceMotion: boolean;
  fullContent: ReactNode;
  resultContent?: ReactNode;
  hasResult?: boolean;
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
  resultContent,
  hasResult = false,
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

  const showsActions = mode === "peek" || mode === "actions";
  const geometry = getIslandGeometry(mode);
  // One spring drives width+height+radius so they progress in lockstep —
  // capsule modes keep r = h/2 all through the morph — and mid-flight
  // retargets carry velocity instead of restarting a fixed curve. Collapse
  // is near-critically damped; expansion keeps a small ~4% overshoot that
  // the padded native canvas leaves room for.
  const surfaceTransition: Transition = instant
    ? { duration: 0 }
    : {
        type: "spring",
        ...(mode === "idle"
          ? { stiffness: 400, damping: 33 }
          : { stiffness: 300, damping: 25 }),
      };
  const islandStyle = {
    "--island-full-width": `${getIslandGeometry("full").width}px`,
    "--island-full-height": `${getIslandGeometry("full").height}px`,
    "--island-width": `${geometry.width}px`,
    "--island-height": `${geometry.height}px`,
    "--island-enter-delay": `${ISLAND_TIMING.fullContentEnterDelayMs}ms`,
    "--island-enter-ms": `${ISLAND_TIMING.fullContentEnterMs}ms`,
    "--island-exit-ms": `${ISLAND_TIMING.fullContentExitMs}ms`,
    "--island-radius": `${geometry.borderRadius}px`,
  } as CSSProperties;
  const islandClassName = [
    "translation-island",
    `translation-island--${mode}`,
    `translation-island--${dockSide}`,
    // The idle PHASE must not emit `translation-island--idle`: every CSS rule
    // under that class targets the idle MODE (full-width core). A translation
    // state arriving while the island is in full mode leaves phase="idle" set,
    // and the next actions/peek expand would render the core at 100% — a wide
    // capsule with only the centered V that swallows every click.
    phase !== "idle" && `translation-island--${phase}`,
    `translation-island--${visualPhase}`,
    instant && "translation-island--instant",
    hasResult && "translation-island--has-result",
  ].filter(Boolean).join(" ");

  const coreLabel = mode === "idle"
    ? "展开快速工具"
    : mode === "peek"
      ? "固定快速工具"
      : mode === "actions"
        ? "收起快速工具"
        : phase === "working"
          ? "正在翻译"
          : phase === "done"
            ? (hasResult ? "展开译文卡片" : "收起翻译完成提示")
            : "查看翻译错误";

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
      <motion.div
        className="translation-island__surface"
        data-mode={mode}
        data-transition-generation={generation}
        initial={false}
        animate={{
          width: geometry.width,
          height: geometry.height,
          borderRadius: geometry.borderRadius,
        }}
        transition={surfaceTransition}
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

        <IslandCompactContent mode={mode} phase={phase} instant={instant} generation={generation}
          contentWidth={Math.max(0, geometry.width - 58)} notice={notice} busyAction={busyAction}
          hasResult={hasResult} onRunAction={onRunAction} onCoreClick={onCoreClick} />

        {mode === "result" && (
          <div className="translation-island__result" aria-hidden={visualPhase !== "stable"}>
            {resultContent}
          </div>
        )}

        {/* The core stays mounted through the full morph: pinned to the anchor
            corner it reads as the card brand's origin, then hands off via the
            CSS crossfade once the workspace has faded in. */}
        {mode !== "result" && (
          <motion.button
            type="button"
            className="translation-island__core"
            disabled={(mode === "status" && phase === "working") || mode === "full"}
            aria-expanded={showsActions}
            aria-hidden={mode === "full" ? true : undefined}
            tabIndex={mode === "full" ? -1 : undefined}
            aria-label={coreLabel}
            title={mode === "full" ? undefined : coreLabel}
            onClick={onCoreClick}
          >
            <VanishMark
              compact
              animated={false}
              decorative
            />
            {mode === "idle" && (
              <span className="island-idle-reveal" aria-hidden="true">
                <span className="island-idle-label">{hasResult ? "译文就绪" : "VanishTrans"}</span>
              </span>
            )}
            {mode === "idle" && hasResult && <span className="island-idle-dot" aria-hidden="true" />}
          </motion.button>
        )}
      </motion.div>
    </aside>
  );
}
