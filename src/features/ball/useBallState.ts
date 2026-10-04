import { useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  type BallAction, type DockSide, type IslandMode, type IslandPhase, type IslandPresentation,
} from "../islandModel";
import { type SnapEdge } from "./ballSnap";
import { IslandTransitionCoordinator } from "../islandTransitionCoordinator";
import { type IslandErrorDetail } from "./ballActivity";
import type { IslandResult } from "../../lib/translationResult";

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
  const [result, setResult] = useState<IslandResult | null>(null);
  const resultRef = useRef<IslandResult | null>(null);
  const [resultToOpen, setResultToOpen] = useState<IslandResult | null>(null);
  const commitResult = useCallback((next: IslandResult | null) => {
    resultRef.current = next;
    setResult(next);
  }, []);
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
  // Null or the session scope ("quick:") a launched action waits on; only
  // events carrying that sourceId may clear the expectation.
  const expectingTranslationRef = useRef<string | null>(null);
  const statusErrorRef = useRef<IslandErrorDetail>({ sourceId: null, message: null });
  const busyActionRef = useRef<BallAction | null>(null);
  const noticeRef = useRef("");
  const expectedActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionSettledAtRef = useRef(Number.NEGATIVE_INFINITY);
  const fullPinnedRef = useRef(false);
  const phaseRef = useRef<IslandPhase>("working");
  /** Surface lift animation state while a native drag is in progress. */
  const [dragging, setDragging] = useState(false);
  /** Edges the window is currently snapped against (drives flush-edge layout). */
  const [dockedEdges, setDockedEdges] = useState<SnapEdge[]>([]);
  const dockedEdgesRef = useRef<SnapEdge[]>([]);
  const commitDockedEdges = useCallback((edges: SnapEdge[]) => {
    const current = dockedEdgesRef.current;
    if (current.length === edges.length && current.every((edge, i) => edge === edges[i])) return;
    dockedEdgesRef.current = edges;
    setDockedEdges(edges);
  }, []);
  /** Monotonic stamp; changing it replays the snap-landing squash. */
  const [landedAt, setLandedAt] = useState(0);
  /** Cancellation token for in-flight snap-settle animations. */
  const snapAnimSeqRef = useRef(0);

  const commitPresentation = useCallback((next: IslandPresentation) => {
    presentationRef.current = next;
    flushSync(() => setPresentation(next));
  }, []);

  return {
    shouldReduceMotion, mode, modeRef, nativeModeRef, nativeTargetModeRef, presentationRef, dockSideRef,
    pointerOriginRef, pointerCaptureTargetRef, draggingRef, transitionCoordinatorRef, transitionCoordinator,
    coordinatorLifetimeRef, lastDragEndedAtRef, anchorPositionRef, idleOuterSizeRef, expectingTranslationRef,
    busyActionRef, noticeRef, expectedActivityTimerRef, noticeTimerRef, statusTimerRef, fullPinnedRef,
    focusCollapseTimerRef, transitionSettledAtRef, statusErrorRef,
    phaseRef, commitPresentation, presentation, setPresentation, phase, setPhase, dockSide, setDockSide,
    busyAction, setBusyAction, notice, setNotice,
    result, resultRef, commitResult, resultToOpen, setResultToOpen,
    dragging, setDragging, dockedEdges, setDockedEdges, dockedEdgesRef, commitDockedEdges, landedAt, setLandedAt, snapAnimSeqRef,
  };
}
export type BallState = ReturnType<typeof useBallState>;
