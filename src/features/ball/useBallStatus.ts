import { useCallback, useRef, useState } from "react";
import type { IslandPhase } from "../islandModel";

export interface BallStatusResult {
  notice: string;
  phase: IslandPhase;
  noticeRef: React.MutableRefObject<string>;
  phaseRef: React.MutableRefObject<IslandPhase>;
  setNotice: (message: string) => void;
  setPhase: (newPhase: IslandPhase) => void;
  clearNotice: () => void;
  setNoticeWithTimer: (message: string, durationMs?: number) => void;
  clearAllTimers: () => void;
}

/**
 * Hook for managing ball island status display (notice messages and phase).
 *
 * Responsibilities:
 * - Display temporary notice messages with auto-clear
 * - Track current phase (working, done, error, idle)
 * - Manage multiple timers for status changes
 */
export function useBallStatus(): BallStatusResult {
  const [notice, setNoticeState] = useState("");
  const [phase, setPhaseState] = useState<IslandPhase>("working");

  // Refs for synchronous access in callbacks
  const noticeRef = useRef("");
  const phaseRef = useRef<IslandPhase>("working");

  // Timers
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expectedActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setNotice = useCallback((message: string) => {
    noticeRef.current = message;
    setNoticeState(message);
  }, []);

  const setPhase = useCallback((newPhase: IslandPhase) => {
    phaseRef.current = newPhase;
    setPhaseState(newPhase);
  }, []);

  const clearNotice = useCallback(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    noticeRef.current = "";
    setNoticeState("");
  }, []);

  /**
   * Set a notice message that automatically clears after a duration.
   * @param message - The notice message to display
   * @param durationMs - Duration in milliseconds (default: 3000ms)
   */
  const setNoticeWithTimer = useCallback((message: string, durationMs = 3000) => {
    noticeRef.current = message;
    setNoticeState(message);

    // Clear any existing timer
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    // Set new timer to clear notice
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      noticeRef.current = "";
      setNoticeState("");
    }, durationMs);
  }, []);

  /**
   * Clear all status-related timers (call on unmount or cleanup).
   */
  const clearAllTimers = useCallback(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    if (expectedActivityTimerRef.current) {
      clearTimeout(expectedActivityTimerRef.current);
      expectedActivityTimerRef.current = null;
    }
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  return {
    notice,
    phase,
    noticeRef,
    phaseRef,
    setNotice,
    setPhase,
    clearNotice,
    setNoticeWithTimer,
    clearAllTimers,
  };
}
