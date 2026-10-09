import { useCallback } from "react";
import { errorMessage } from "../../lib/errors";
import { logInfo } from "../../lib/logger";
import { type BallAction, type IslandPhase } from "../islandModel";
import { invokeCommand } from "./ballNative";
import { QUICK_SESSION_SCOPE } from "./ballActivity";
import { type BallState } from "./useBallState";
import { type BallTransitions } from "./useBallTransitions";
import { useBallViewActions } from "./useBallViewActions";

type BallActionsState = Pick<BallState,
  "modeRef" | "draggingRef" | "transitionCoordinator" | "lastDragEndedAtRef" |
  "expectingTranslationRef" | "busyActionRef" | "noticeRef" | "expectedActivityTimerRef" |
  "noticeTimerRef" | "statusTimerRef" | "phase" | "setBusyAction" |
  "setNotice" | "resultRef" | "setResultToOpen" | "dismissResult" | "transitionSettledAtRef" | "statusErrorRef"
> & Pick<BallTransitions, "transitionMode" | "requestFocusCollapse">;

/** The status-mode collapse leaves errors up twice as long as done notices;
 *  the same budget applies when a click surfaces the failure in the island. */
const ERROR_NOTICE_MS = 6000;

export function useBallActions({
  modeRef, draggingRef, transitionCoordinator, lastDragEndedAtRef, expectingTranslationRef, busyActionRef,
  noticeRef, expectedActivityTimerRef, noticeTimerRef, statusTimerRef, phase, setBusyAction, setNotice,
  transitionMode, resultRef, setResultToOpen, dismissResult, transitionSettledAtRef, statusErrorRef, requestFocusCollapse,
}: BallActionsState) {
  const viewActions = useBallViewActions({
    modeRef, resultRef, setResultToOpen, dismissResult, draggingRef, lastDragEndedAtRef, transitionMode,
  });
  const { expandFull } = viewActions;
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
      requestFocusCollapse("instant");
    }
  }, [
    transitionCoordinator, requestFocusCollapse, modeRef, draggingRef, expectingTranslationRef, busyActionRef,
    noticeRef,
  ]);

  const showNotice = useCallback((message: string, durationMs = 2200) => {
    noticeRef.current = message;
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      noticeRef.current = "";
      setNotice("");
    }, durationMs);
  }, [noticeRef, noticeTimerRef, setNotice]);

  const toggleActions = useCallback(async () => {
    if (modeRef.current === "actions") {
      // While an open transition is in flight — and for a beat after it ends
      // while the action strip is still growing — the core button still covers
      // the strip area; a click there means "open", not "close". Dropping it
      // stops rapid clicks from flapping the island open/shut forever.
      if (transitionCoordinator.requestedTarget === "actions"
        || performance.now() - transitionSettledAtRef.current < 350) return;
      await transitionMode("idle");
    }
    else if (modeRef.current === "peek") await transitionMode("actions");
    else if (modeRef.current === "idle") await transitionMode("actions");
  }, [transitionMode, modeRef, transitionCoordinator, transitionSettledAtRef]);

  const handleCoreClick = useCallback(async () => {
    logInfo("ball.click", "core click", {
      mode: modeRef.current,
      phase,
      transitioning: transitionCoordinator.isTransitioning,
      requested: transitionCoordinator.requestedTarget,
      dragging: draggingRef.current,
      busy: busyActionRef.current,
      expecting: expectingTranslationRef.current,
      hasResult: resultRef.current !== null,
    });
    if (draggingRef.current || performance.now() - lastDragEndedAtRef.current < 250) return;
    if (modeRef.current === "status") {
      if (phase !== "working") {
        if (phase === "error") {
          // The error belongs to the session that failed. A quick-session
          // failure already displays in the quick window, so the island shows
          // the message itself; main-session failures live in the embedded
          // workspace, so open it. Anonymous errors keep the old "full" route.
          const detail = statusErrorRef.current;
          if (detail.sourceId !== null && detail.sourceId.startsWith(QUICK_SESSION_SCOPE)) {
            showNotice(detail.message ?? "翻译失败，请重试", ERROR_NOTICE_MS);
            await transitionMode("actions");
          } else {
            await transitionMode("full");
          }
          return;
        }
        const target = phase === "done" && resultRef.current ? "result" : "idle";
        await transitionMode(target);
      }
      return;
    }
    if (modeRef.current === "idle" && resultRef.current) {
      await transitionMode("result");
      return;
    }
    await toggleActions();
  }, [
    phase, toggleActions, transitionMode, modeRef, draggingRef, lastDragEndedAtRef, resultRef,
    busyActionRef, expectingTranslationRef, transitionCoordinator, showNotice, statusErrorRef,
  ]);

  const runAction = useCallback(async (action: BallAction, command: string) => {
    if (draggingRef.current || performance.now() - lastDragEndedAtRef.current < 250) return;
    if (action === "main") {
      busyActionRef.current = action;
      setBusyAction(action);
      try {
        await expandFull();
      } finally {
        busyActionRef.current = null;
        setBusyAction(null);
      }
      return;
    }

    const expectsTranslationState = action === "clipboard";
    if (expectsTranslationState) {
      // Clipboard translations run in the quick session; only "quick:" events
      // resolve this expectation (see useBallEvents).
      expectingTranslationRef.current = QUICK_SESSION_SCOPE;
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
            expectingTranslationRef.current = null;
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
      expectingTranslationRef.current = null;
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
    expectingTranslationRef, busyActionRef, expectedActivityTimerRef, setBusyAction,
  ]);

  const openActions = useCallback(async () => {
    if (draggingRef.current || performance.now() - lastDragEndedAtRef.current < 250) return;
    await toggleActions();
  }, [toggleActions, draggingRef, lastDragEndedAtRef]);

  return { scheduleStatusCollapse, handleIslandBlur, handleCoreClick, openActions, runAction, ...viewActions };
}
export type BallActions = ReturnType<typeof useBallActions>;
