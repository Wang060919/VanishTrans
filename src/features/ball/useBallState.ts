import { useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  type BallAction, type DockSide, type IslandMode, type IslandPhase, type IslandPresentation,
} from "../islandModel";
import { IslandTransitionCoordinator } from "../islandTransitionCoordinator";

/** Owns island state and synchronous refs. Other hooks receive only their required fields. */
export function useBallState() {
  const initialPresentation: IslandPresentation = {
    mode: "idle",
    motion: "instant",
    phase: "stable",
    generation: 0,
  };
  const [presentation, setPresentation] = useState<IslandPresentation>(initialPresentation);
  const [phase, setPhase] = useState<IslandPhase>("working");
  const [dockSide, setDockSide] = useState<DockSide>("center");
  const [busyAction, setBusyAction] = useState<BallAction | null>(null);
  const [notice, setNotice] = useState("");
  const shouldReduceMotion = useReducedMotion();
  const mode = presentation.mode;

  const modeRef = useRef<IslandMode>("idle");
  const nativeModeRef = useRef<IslandMode>("idle");
  const nativeTargetModeRef = useRef<IslandMode>("idle");
  const presentationRef = useRef<IslandPresentation>(initialPresentation);
  const dockSideRef = useRef<DockSide>("center");
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pointerCaptureTargetRef = useRef<Element | null>(null);
  const draggingRef = useRef(false);
  const transitionCoordinatorRef = useRef<IslandTransitionCoordinator | null>(null);
  if (!transitionCoordinatorRef.current) {
    transitionCoordinatorRef.current = new IslandTransitionCoordinator();
  }
  const transitionCoordinator = transitionCoordinatorRef.current;
  const coordinatorLifetimeRef = useRef(0);
  const lastDragEndedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const anchorPositionRef = useRef<{ x: number; y: number } | null>(null);
  const idleOuterSizeRef = useRef<{ width: number; height: number } | null>(null);
  const expectingTranslationRef = useRef(false);
  const busyActionRef = useRef<BallAction | null>(null);
  const noticeRef = useRef("");
  const expectedActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullPinnedRef = useRef(false);
  const phaseRef = useRef<IslandPhase>("working");

  const commitPresentation = useCallback((next: IslandPresentation) => {
    presentationRef.current = next;
    flushSync(() => setPresentation(next));
  }, []);

  return {
    shouldReduceMotion, mode, modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef,
    pointerOriginRef, pointerCaptureTargetRef, draggingRef, transitionCoordinatorRef, transitionCoordinator,
    coordinatorLifetimeRef, lastDragEndedAtRef, anchorPositionRef, idleOuterSizeRef, expectingTranslationRef,
    busyActionRef, noticeRef, expectedActivityTimerRef, noticeTimerRef, statusTimerRef, fullPinnedRef,
    phaseRef, commitPresentation, presentation, setPresentation, phase, setPhase, dockSide, setDockSide,
    busyAction, setBusyAction, notice, setNotice,
  };
}
export type BallState = ReturnType<typeof useBallState>;
