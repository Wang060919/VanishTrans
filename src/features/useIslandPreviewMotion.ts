import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { ISLAND_TIMING, type IslandMode, type IslandPresentation } from "./islandModel";

/** Keep the preview's exit sequence consistent with the native coordinator. */
export function useIslandPreviewMotion(initialMode: IslandMode, animated: boolean) {
  const [mode, commitMode] = useState(initialMode);
  const [phase, setPhase] = useState<IslandPresentation["phase"]>("stable");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The exit timer delays the commit; remember its target so the next setMode
  // resolves against the pending mode instead of the render-captured one.
  const pendingRef = useRef<IslandMode | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const setMode = useCallback((update: SetStateAction<IslandMode>) => {
    const current = pendingRef.current ?? mode;
    const target = typeof update === "function" ? update(current) : update;
    if (timer.current) clearTimeout(timer.current);
    pendingRef.current = target;
    if (animated && (current === "full" || current === "result") && target !== current) {
      setPhase("full-exit");
      timer.current = setTimeout(() => {
        timer.current = null;
        commitMode(target);
        setPhase("stable");
      }, ISLAND_TIMING.fullContentExitMs);
    } else {
      commitMode(target);
      setPhase("stable");
    }
  }, [animated, mode]);
  return { mode, setMode, phase };
}
