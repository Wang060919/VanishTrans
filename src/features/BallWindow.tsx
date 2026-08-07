import MainWindowApp from "./MainWindowApp";
import TranslationIslandView from "./TranslationIslandView";
import { useBallWindow } from "./useBallWindow";

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
      busyAction={island.busyAction}
      notice={island.notice}
      shouldReduceMotion={island.shouldReduceMotion}
      fullContent={(
        <MainWindowApp
          embedded
          onCollapse={island.collapseFull}
          onRequestExpand={island.expandFull}
          onWindowDragStart={island.handleFullDragStart}
          onWindowDragEnd={island.handleFullDragEnd}
          onWindowMoved={island.handleFullWindowMoved}
          onPinChange={island.handlePinChange}
        />
      )}
      onRunAction={(action, command) => void island.runAction(action, command)}
      onCoreClick={() => void island.handleCoreClick()}
      onCorePointerDown={island.handlePointerDown}
      onCorePointerMove={island.handlePointerMove}
      onCorePointerUp={island.handlePointerEnd}
      onCorePointerCancel={island.handlePointerEnd}
      onIslandBlur={island.handleIslandBlur}
    />
  );
}
