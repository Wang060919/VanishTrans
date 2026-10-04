import { describe, expect, it } from "vitest";
import { resolveEdgeSnap, snapAreaFromMonitor } from "./ballSnap";

const AREA = snapAreaFromMonitor({
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
});
const BALL = { width: 124, height: 50 };

describe("resolveEdgeSnap", () => {
  it("returns null when the drop lands outside every snap zone", () => {
    expect(resolveEdgeSnap({ x: 900, y: 500 }, BALL, AREA, 1)).toBeNull();
  });

  it("snaps to the top edge and flags the center band as a notch", () => {
    const snap = resolveEdgeSnap({ x: 898, y: 10 }, BALL, AREA, 1);
    expect(snap).toMatchObject({ y: 0, edges: ["top"], centerHorizontally: true });
  });

  it("snaps to the top edge without centering outside the middle band", () => {
    const snap = resolveEdgeSnap({ x: 200, y: 20 }, BALL, AREA, 1);
    expect(snap).toMatchObject({ x: 200, y: 0, edges: ["top"], centerHorizontally: false });
  });

  it("snaps flush to the left and right edges", () => {
    expect(resolveEdgeSnap({ x: 12, y: 400 }, BALL, AREA, 1))
      .toMatchObject({ x: 0, y: 400, edges: ["left"] });
    expect(resolveEdgeSnap({ x: 1910 - BALL.width, y: 400 }, BALL, AREA, 1))
      .toMatchObject({ x: 1920 - BALL.width, edges: ["right"] });
  });

  it("keeps the edge gutter when snapping to the bottom edge", () => {
    const snap = resolveEdgeSnap({ x: 900, y: 1030 - BALL.height }, BALL, AREA, 1);
    expect(snap).toMatchObject({ x: 900, y: 1040 - BALL.height - 8, edges: ["bottom"] });
  });

  it("snaps both axes at a corner", () => {
    const snap = resolveEdgeSnap({ x: 10, y: 15 }, BALL, AREA, 1);
    expect(snap).toMatchObject({ x: 0, y: 0 });
    expect(snap?.edges).toEqual(["top", "left"]);
  });

  it("honours disabled zones", () => {
    const snap = resolveEdgeSnap(
      { x: 10, y: 15 }, BALL, AREA, 1, { sides: false, bottom: false },
    );
    expect(snap?.edges).toEqual(["top"]);
  });

  it("scales thresholds with the monitor scale factor", () => {
    // At 1.5x the 32 CSS-px top zone becomes 48 physical px.
    expect(resolveEdgeSnap({ x: 900, y: 40 }, BALL, AREA, 1.5)?.edges).toEqual(["top"]);
    expect(resolveEdgeSnap({ x: 900, y: 40 }, BALL, AREA, 1)).toBeNull();
  });
});
