import { logError, logInfo } from "../../lib/logger";
import {
  getIslandClipPad, getIslandGeometry,
  type DockSide, type IslandMode,
} from "../islandModel";
import {
  isIslandTransitionAborted, type IslandTransitionContext,
} from "../islandTransitionCoordinator";
import { settleBallSurface } from "./ballSurfaceSettlement";
import { setBallWindowBounds } from "./ballNative";
import { type BallState } from "./useBallState";

type ClipRefs = Pick<BallState, "modeRef" | "nativeModeRef" | "transitionCoordinator">;

/**
 * Rect the window region is clipped back to after a morph: the painted shape
 * inside the (possibly padded) canvas, plus a ring that keeps the antialiased
 * edge — and for capsules the press bulge — hittable.
 */
export function islandClipRequest({
  target, side, scale, windowX, expandedY, windowWidth,
}: {
  target: IslandMode;
  side: DockSide;
  scale: number;
  windowX: number;
  expandedY: number;
  windowWidth: number;
}) {
  const visible = getIslandGeometry(target);
  const width = Math.round(visible.width * scale);
  const height = Math.round(visible.height * scale);
  const offset = side === "center" ? Math.round((windowWidth - width) / 2)
    : side === "left" ? windowWidth - width : 0;
  return {
    x: windowX + offset,
    y: expandedY,
    width,
    height,
    retainSurface: true,
    clip: {
      cornerRadius: Math.round(visible.borderRadius * scale),
      pad: getIslandClipPad(target, scale),
    },
  };
}

interface ClipSpec {
  target: IslandMode;
  nativeTarget: IslandMode;
  side: DockSide;
  scale: number;
  windowX: number;
  expandedY: number;
  windowWidth: number;
  windowHeight: number;
  settleMs: number;
}

function clipLogFields(spec: ClipSpec) {
  const request = islandClipRequest(spec);
  return {
    target: spec.target,
    nativeTarget: spec.nativeTarget,
    side: spec.side,
    clip: { x: request.x, y: request.y, width: request.width, height: request.height },
    canvas: {
      x: spec.windowX, y: spec.expandedY, width: spec.windowWidth, height: spec.windowHeight,
    },
  };
}

/** In-task clip: the caller's signal already aborts on supersession. */
export async function clipExpandedSurface(spec: ClipSpec, signal: AbortSignal) {
  await settleBallSurface(spec.settleMs, signal);
  if (signal.aborted) return;
  logInfo("ball.transition", "clip after expand", clipLogFields(spec));
  await setBallWindowBounds(islandClipRequest(spec));
}

/**
 * Detached clip for windows that freshly shrank to the target canvas: the
 * transition task resolves with the visual commit so the island answers input
 * while the spring settles, then this clips. A superseding task flips these
 * refs (or queues another requestedTarget) before touching native geometry,
 * so a stale clip never lands on a resized window.
 */
export function clipExpandedSurfaceDetached(
  refs: ClipRefs,
  spec: ClipSpec,
  context: IslandTransitionContext,
) {
  const { modeRef, nativeModeRef, transitionCoordinator } = refs;
  void (async () => {
    try {
      await settleBallSurface(spec.settleMs, context.signal);
      const requested = transitionCoordinator.requestedTarget;
      if (context.signal.aborted
        || transitionCoordinator.isDisposed
        || modeRef.current !== spec.target
        || nativeModeRef.current !== spec.nativeTarget
        || (requested !== null && requested !== spec.target)) return;
      logInfo("ball.transition", "clip after expand", clipLogFields(spec));
      await setBallWindowBounds(islandClipRequest(spec));
    } catch (error) {
      if (!isIslandTransitionAborted(error)) {
        logError("ball.transition", "post-settle clip failed", error);
      }
    }
  })();
}
