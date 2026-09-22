import { useBallState } from "./ball/useBallState";
import { useBallTransitions } from "./ball/useBallTransitions";
import { useBallActions } from "./ball/useBallActions";
import { useBallDrag } from "./ball/useBallDrag";
import { useBallFullPosition } from "./ball/useBallFullPosition";
import { useBallEvents } from "./ball/useBallEvents";
export { normalizeTranslationActivity } from "./ball/ballActivity";

/** Composition root: state -> serialized transitions -> actions/dragging -> native events. */
export function useBallWindow() {
  const state = useBallState();
  const transitions = useBallTransitions(state);
  const actions = useBallActions({ ...state, ...transitions });
  const drag = useBallDrag({ ...state, ...actions });
  const position = useBallFullPosition(state);
  useBallEvents({ ...state, ...transitions, ...actions, ...drag });
  return {
    presentation: state.presentation,
    phase: state.phase,
    dockSide: state.dockSide,
    busyAction: state.busyAction,
    notice: state.notice,
    shouldReduceMotion: state.shouldReduceMotion ?? false,
    ...actions,
    ...drag,
    ...position,
  };
}
