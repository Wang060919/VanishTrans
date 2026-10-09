import MainWindowApp from "./MainWindowApp";
import TranslationIslandView from "./TranslationIslandView";
import { useBallWindow } from "./useBallWindow";
import IslandResultPanel from "./IslandResultPanel";

export { normalizeTranslationActivity } from "./useBallWindow";

/**
 * Floating translation island window.
 *
 * The island state machine (transitions, dragging, actions, effects) lives in
 * `useBallWindow`; this component only wires it to the view.
 */
export default function BallWindow() {
  const island = useBallWindow();

  return (
    <TranslationIslandView
      presentation={island.presentation}
      phase={island.phase}
      dockSide={island.dockSide}
      dragging={island.dragging}
      dockedEdges={island.dockedEdges}
      landedAt={island.landedAt}
      busyAction={island.busyAction}
      notice={island.notice}
      hasResult={island.result !== null}
      resultContent={island.result && (
        <IslandResultPanel result={island.result} onExpand={() => void island.openResultInFull()}
          onClose={() => void island.closeResult()} />
      )}
      shouldReduceMotion={island.shouldReduceMotion}
      fullContent={(
        <MainWindowApp
          embedded
          resultToOpen={island.resultToOpen}
          onCollapse={island.collapseFull}
          onScreenshot={() => island.runAction("screenshot", "start_screenshot_from_ball")}
          onWindowDragStart={island.handleFullDragStart}
          onWindowDragEnd={island.handleFullDragEnd}
          onWindowMoved={island.handleFullWindowMoved}
          onPinChange={island.handlePinChange}
        />
      )}
      onRunAction={(action, command) => void island.runAction(action, command)}
      onCoreClick={() => void island.handleCoreClick()}
      onOpenActions={() => void island.openActions()}
      onCorePointerDown={island.handlePointerDown}
      onCorePointerMove={island.handlePointerMove}
      onCorePointerUp={island.handlePointerEnd}
      onCorePointerCancel={island.handlePointerEnd}
      onIslandBlur={island.handleIslandBlur}
    />
  );
}
