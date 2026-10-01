import { useCallback } from "react";
import { errorMessage } from "../../lib/errors";
import { type BallAction, type IslandPhase } from "../islandModel";
import { invokeCommand } from "./ballNative";
import { type BallState } from "./useBallState";
import { type BallTransitions } from "./useBallTransitions";

type BallActionsState = Pick<BallState,
  "modeRef" | "draggingRef" | "transitionCoordinator" | "lastDragEndedAtRef" |
  "expectingTranslationRef" | "busyActionRef" | "noticeRef" | "expectedActivityTimerRef" |
  "noticeTimerRef" | "statusTimerRef" | "phase" | "setBusyAction" |
  "setNotice" | "resultRef" | "setResultToOpen"
> & Pick<BallTransitions, "transitionMode">;

export function useBallActions({
  modeRef, draggingRef, transitionCoordinator, lastDragEndedAtRef, expectingTranslationRef, busyActionRef,
  noticeRef, expectedActivityTimerRef, noticeTimerRef, statusTimerRef, phase, setBusyAction, setNotice,
  transitionMode, resultRef, setResultToOpen,
}: BallActionsState) {
  const scheduleStatusCollapse = useCallback((statusPhase: IslandPhase) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
    if (statusPhase === "working") return;
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      const effectiveMode = transitionCoordinator.requestedTarget ?? modeRef.current;
      if (effectiveMode === "status") {
        void transitionMode("idle", { reason: "business" });
      }
    }, statusPhase === "done" ? (resultRef.current ? 6000 : 1250) : 6000);
  }, [transitionCoordinator, transitionMode, modeRef, statusTimerRef, resultRef]);

  const handleIslandBlur = useCallback((event: React.FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (modeRef.current === "actions"
      && !transitionCoordinator.isTransitioning
      && !draggingRef.current
      && busyActionRef.current === null
      && !expectingTranslationRef.current
      && !noticeRef.current) {
      void transitionMode("idle", { motion: "instant", reason: "focus-loss" });
    }
  }, [
    transitionCoordinator, transitionMode, modeRef, draggingRef, expectingTranslationRef, busyActionRef,
    noticeRef,
  ]);

  const toggleActions = useCallback(async () => {
    if (modeRef.current === "actions") await transitionMode("idle");
    else if (modeRef.current === "peek") await transitionMode("actions");
    else if (modeRef.current === "idle") await transitionMode("actions");
  }, [transitionMode, modeRef]);

  const handleCoreClick = useCallback(async () => {
    if (draggingRef.current || performance.now() - lastDragEndedAtRef.current < 250) return;
    if (modeRef.current === "status") {
      if (phase !== "working") {
        const target = phase === "error" ? "full" : phase === "done" && resultRef.current ? "result" : "idle";
        await transitionMode(target);
      }
      return;
    }
    await toggleActions();
  }, [phase, toggleActions, transitionMode, modeRef, draggingRef, lastDragEndedAtRef, resultRef]);

  const openResultInFull = useCallback(async () => {
    if (!resultRef.current || draggingRef.current
      || performance.now() - lastDragEndedAtRef.current < 250) return;
    setResultToOpen(resultRef.current);
    await transitionMode("full");
  }, [resultRef, draggingRef, lastDragEndedAtRef, setResultToOpen, transitionMode]);

  const expandFull = useCallback(async () => {
    await transitionMode("full");
  }, [transitionMode]);

  const collapseFull = useCallback(async () => {
    await transitionMode("idle");
  }, [transitionMode]);

  const showNotice = useCallback((message: string) => {
    noticeRef.current = message;
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      noticeRef.current = "";
      setNotice("");
    }, 2200);
  }, [noticeRef, noticeTimerRef, setNotice]);

  const runAction = useCallback(async (action: BallAction, command: string) => {
    if (draggingRef.current || performance.now() - lastDragEndedAtRef.current < 250) return;
    if (action === "main") {
      busyActionRef.current = action;
      setBusyAction(action);
      try {
        if (resultRef.current) await transitionMode("result");
        else await expandFull();
      } finally {
        busyActionRef.current = null;
        setBusyAction(null);
      }
      return;
    }

    const expectsTranslationState = action === "clipboard";
    if (expectsTranslationState) {
      expectingTranslationRef.current = true;
      if (expectedActivityTimerRef.current) clearTimeout(expectedActivityTimerRef.current);
    }
    busyActionRef.current = action;
    setBusyAction(action);
    try {
      if (action === "screenshot") {
        // Hidden WebViews can suspend animation frames. Settle and unmount the
        // action strip before the screenshot command hides this window.
        await transitionMode("idle", { motion: "instant", reason: "business" });
      }
      await invokeCommand(command);
      if (expectsTranslationState) {
        if (expectingTranslationRef.current) {
          expectedActivityTimerRef.current = setTimeout(() => {
            expectingTranslationRef.current = false;
            expectedActivityTimerRef.current = null;
            if (modeRef.current === "peek" || modeRef.current === "actions") {
              void transitionMode("idle");
            }
          }, 900);
        }
      } else if (action !== "screenshot") {
        await transitionMode("idle");
      }
    } catch (error) {
      expectingTranslationRef.current = false;
      if (expectedActivityTimerRef.current) {
        clearTimeout(expectedActivityTimerRef.current);
        expectedActivityTimerRef.current = null;
      }
      const message = errorMessage(error);
      showNotice(message || "操作失败，请重试");
      if (action === "screenshot") {
        await transitionMode("actions", { motion: "instant", reason: "business" });
      }
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  }, [
    expandFull, showNotice, transitionMode, modeRef, draggingRef, lastDragEndedAtRef,
    expectingTranslationRef, busyActionRef, expectedActivityTimerRef, setBusyAction, resultRef,
  ]);

  return { scheduleStatusCollapse, handleIslandBlur, handleCoreClick, expandFull, collapseFull, runAction, openResultInFull };
}
export type BallActions = ReturnType<typeof useBallActions>;
