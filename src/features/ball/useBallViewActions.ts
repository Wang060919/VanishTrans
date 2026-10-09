import { useCallback } from "react";
import { type BallState } from "./useBallState";
import { type BallTransitions } from "./useBallTransitions";

type BallViewState = Pick<BallState,
  "modeRef" | "resultRef" | "setResultToOpen" | "dismissResult" |
  "draggingRef" | "lastDragEndedAtRef"
> & Pick<BallTransitions, "transitionMode">;

export function useBallViewActions({
  modeRef, resultRef, setResultToOpen, dismissResult, draggingRef, lastDragEndedAtRef, transitionMode,
}: BallViewState) {
  const openResultInFull = useCallback(async () => {
    if (!resultRef.current || draggingRef.current
      || performance.now() - lastDragEndedAtRef.current < 250) return;
    setResultToOpen(resultRef.current);
    await transitionMode("full");
  }, [resultRef, draggingRef, lastDragEndedAtRef, setResultToOpen, transitionMode]);

  const closeResult = useCallback(async () => {
    if (modeRef.current !== "result") return;
    dismissResult();
    await transitionMode("idle");
  }, [modeRef, dismissResult, transitionMode]);

  const expandFull = useCallback(async () => {
    await transitionMode("full");
  }, [transitionMode]);

  const collapseFull = useCallback(async () => {
    await transitionMode("idle");
  }, [transitionMode]);

  return { openResultInFull, closeResult, expandFull, collapseFull };
}
