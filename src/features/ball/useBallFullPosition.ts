import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";
import { useCallback } from "react";
import { logError } from "../../lib/logger";
import {
  getExpandedX, getIdleAnchorX, getIslandClipPad, getIslandGeometry,
  ISLAND_WINDOW_POLICY,
} from "../islandModel";
import { paintedIslandRect, resolveEdgeSnap, snapAreaFromMonitor } from "./ballSnap";
import { animateWindowPosition } from "./ballSnapSettle";
import { IDLE_WIDTH, IDLE_HEIGHT, saveBallPosition, setBallWindowBounds } from "./ballNative";
import { type BallState } from "./useBallState";

type BallFullPositionState = Pick<BallState,
  "modeRef" | "dockSideRef" | "anchorPositionRef" | "idleOuterSizeRef" |
  "dockedEdgesRef" |
  "shouldReduceMotion" | "snapAnimSeqRef" | "setLandedAt" | "commitDockedEdges">;

export function useBallFullPosition({
  modeRef, dockSideRef, anchorPositionRef, idleOuterSizeRef, dockedEdgesRef,
  shouldReduceMotion, snapAnimSeqRef, setLandedAt, commitDockedEdges,
}: BallFullPositionState) {
  const handleFullWindowMoved = useCallback(async () => {
    try {
      if (modeRef.current !== "full") return;
      // Claim the settle token before any await: another move event supersedes
      // this run, and a later grab still bumps the ref to abort the slide.
      const seq = ++snapAnimSeqRef.current;
      const win = getCurrentWindow();
      const rect = await paintedIslandRect(win, "full", dockSideRef.current);
      const windowPosition = { x: rect.x - rect.offsetX, y: rect.y - rect.offsetY };
      const monitor = await monitorFromPoint(
        rect.x + rect.width / 2,
        rect.y + Math.min(24, rect.height / 2),
      ) ?? await currentMonitor();
      const scale = monitor?.scaleFactor ?? await win.scaleFactor();
      const outerSize = await win.outerSize();
      const innerSize = await win.innerSize();
      const chromeWidth = outerSize.width - innerSize.width;
      const chromeHeight = outerSize.height - innerSize.height;
      const idleOuterWidth = Math.round(IDLE_WIDTH * scale) + chromeWidth;
      const idleOuterHeight = Math.round(IDLE_HEIGHT * scale) + chromeHeight;
      idleOuterSizeRef.current = { width: idleOuterWidth, height: idleOuterHeight };
      const edgeGutterPixels = Math.round(ISLAND_WINDOW_POLICY.edgeGutter * scale);
      let position = windowPosition;

      const previousEdges = dockedEdgesRef.current;
      // The full window snaps to the top edge only; side docking a 560px card
      // reads as a misplaced panel, not a docked island.
      const snap = monitor
        ? resolveEdgeSnap(
            rect, { width: rect.width, height: rect.height },
            snapAreaFromMonitor(monitor), scale,
            { sides: false, bottom: false },
          )
        : null;
      if (snap) {
        const area = snapAreaFromMonitor(monitor!);
        const centeredAnchorX = area.left
          + Math.round((area.width - idleOuterWidth) / 2);
        const rawSnappedX = getExpandedX(
          dockSideRef.current,
          centeredAnchorX,
          idleOuterWidth,
          rect.width,
        );
        const minX = area.left + edgeGutterPixels;
        const maxX = Math.max(minX, area.right - rect.width - edgeGutterPixels);
        const snappedRectX = Math.min(Math.max(rawSnappedX, minX), maxX);
        const target = {
          x: snappedRectX - rect.offsetX,
          y: snap.y - rect.offsetY,
        };
        const settled = shouldReduceMotion
          ? (await win.setPosition(new PhysicalPosition(target.x, target.y)), true)
          : await animateWindowPosition(
              (x, y) => win.setPosition(new PhysicalPosition(x, y)),
              windowPosition, target, snapAnimSeqRef, seq,
            );
        if (settled) {
          position = target;
          setLandedAt(performance.now());
        } else {
          position = await win.outerPosition();
        }
        // A snap whose target equals the drop position is a no-move land:
        // keep the previous dock state instead of re-flagging a docked edge
        // the session may never have committed (e.g. a top-parked card from
        // before dockedEdges existed).
        const moved = settled
          && (target.x !== windowPosition.x || target.y !== windowPosition.y);
        commitDockedEdges(moved ? snap.edges : dockedEdgesRef.current);
      } else {
        // Dropped away from the top edge: clear any stale dock so the card's
        // corners re-round.
        commitDockedEdges([]);
      }

      // Final guard before persisting: a collapse committed while the move
      // IPC was in flight owns the anchor now; this stale write must not win.
      if (modeRef.current !== "full") return;
      const anchor = {
        x: getIdleAnchorX(
          dockSideRef.current,
          position.x,
          outerSize.width,
          idleOuterWidth,
        ),
        y: position.y,
      };
      anchorPositionRef.current = await saveBallPosition(anchor, false);

      // The region clip still carries the rounded (or squared) silhouette of
      // the previous dock state — rebuild it only when the dock changed, so
      // painted square/round corners and the hittable region agree again.
      if (previousEdges !== dockedEdgesRef.current) {
        try {
          const painted = await paintedIslandRect(win, "full", dockSideRef.current);
          const geometry = getIslandGeometry("full");
          await setBallWindowBounds({
            x: painted.x,
            y: painted.y,
            width: painted.width,
            height: painted.height,
            retainSurface: true,
            clip: {
              cornerRadius: Math.round(geometry.borderRadius * scale),
              pad: getIslandClipPad("full", scale),
              ...(dockedEdgesRef.current.length
                ? { squareEdges: dockedEdgesRef.current }
                : {}),
            },
          });
        } catch {
          // Clip refresh is cosmetic; the persisted anchor already landed.
        }
      }
    } catch (error) {
      logError("ball.drag", "save expanded translation island position failed", error);
    }
  }, [
    modeRef, dockSideRef, anchorPositionRef, idleOuterSizeRef, dockedEdgesRef,
    shouldReduceMotion, snapAnimSeqRef, setLandedAt, commitDockedEdges,
  ]);

  return { handleFullWindowMoved };
}
export type BallFullPosition = ReturnType<typeof useBallFullPosition>;
