import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, monitorFromPoint } from "@tauri-apps/api/window";
import { type DockSide, type IslandMode } from "../islandModel";
import {
  paintedIslandRect,
  resolveEdgeSnap,
  snapAreaFromMonitor,
  type SnapEdge,
} from "./ballSnap";

/** Minimal window surface the snap path needs; Tauri's WebviewWindow fits. */
interface SnapWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  innerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
  setPosition(position: PhysicalPosition): Promise<void>;
}

const SNAP_SETTLE_FRAMES = 9; // ~144ms at 60fps
const SNAP_FRAME_FALLBACK_MS = 16;

/**
 * Slides the window to the snap target over a fixed frame budget (ease-out
 * cubic), so the user sees the edge capture instead of a teleport. A fixed
 * frame count keeps the loop finite under fake timers; the timeout fallback
 * covers occluded windows where rAF stalls. `seq`/`seqValue` is the cancel
 * token: bump the ref (e.g. a new pointerdown) to abort. Resolves true only
 * when the target frame was applied.
 */
export async function animateWindowPosition(
  apply: (x: number, y: number) => Promise<unknown>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  seq: { current: number },
  seqValue: number,
): Promise<boolean> {
  for (let frame = 1; frame <= SNAP_SETTLE_FRAMES; frame += 1) {
    if (seq.current !== seqValue) return false;
    const eased = 1 - Math.pow(1 - frame / SNAP_SETTLE_FRAMES, 3);
    await apply(
      Math.round(from.x + (to.x - from.x) * eased),
      Math.round(from.y + (to.y - from.y) * eased),
    );
    if (frame === SNAP_SETTLE_FRAMES) return true;
    await Promise.race([
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, SNAP_FRAME_FALLBACK_MS)),
    ]);
  }
  return false;
}

export interface SnapSettle {
  /** The window outer position to persist — the snap target translated back
      from the painted rect, or the real position when the settle was
      cancelled mid-slide. */
  position: { x: number; y: number };
  edges: SnapEdge[];
  landed: boolean;
}

/**
 * Drop-and-snap for the ball window: resolves the painted island rect against
 * the work area under the drop, slides the window so the capsule lands on the
 * edge (unless reduce-motion), and reports the final window position. The
 * caller persists the anchor derived from `position`. `seq` is claimed
 * before the measurement awaits so a fresh grab lands while measuring still
 * aborts the slide.
 */
export async function settleDroppedWindow(
  win: SnapWindow,
  mode: IslandMode,
  dockSide: DockSide,
  reduceMotion: boolean,
  seq: { current: number },
): Promise<SnapSettle> {
  // Claim the token now: a pointerdown that bumps seq while the awaits below
  // run must stop the slide, not get adopted into it.
  const seqValue = ++seq.current;
  const rect = await paintedIslandRect(win, mode, dockSide);
  const monitor = await monitorFromPoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  ) ?? await currentMonitor();
  const windowPosition = { x: rect.x - rect.offsetX, y: rect.y - rect.offsetY };
  // No monitor to snap against: still report the drop position, with an empty
  // edge set so a stale docked silhouette can't survive a mid-screen drop.
  if (!monitor) return { position: windowPosition, edges: [], landed: false };
  const scale = monitor.scaleFactor ?? await win.scaleFactor();
  const area = snapAreaFromMonitor(monitor);
  const snap = resolveEdgeSnap(
    rect,
    { width: rect.width, height: rect.height },
    area,
    scale,
  );
  if (!snap) return { position: windowPosition, edges: [], landed: false };
  // Center-band drops land the capsule centered over the work area, the same
  // way a top-docked full card centers itself.
  const snapX = snap.centerHorizontally
    ? area.left + Math.round((area.width - rect.width) / 2)
    : snap.x;
  const target = { x: snapX - rect.offsetX, y: snap.y - rect.offsetY };
  const landed = reduceMotion
    ? (await win.setPosition(new PhysicalPosition(target.x, target.y)), true)
    : await animateWindowPosition(
        (x, y) => win.setPosition(new PhysicalPosition(x, y)),
        windowPosition, target, seq, seqValue,
      );
  return {
    position: landed ? target : await win.outerPosition(),
    edges: landed ? snap.edges : [],
    landed,
  };
}


