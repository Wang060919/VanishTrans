import { expect, it } from "vitest";
import { type DockSide } from "../islandModel";
import { islandClipRequest } from "./ballSurfaceClip";

it("sends the painted scale and alignment so native clipping can survive a DPI switch", () => {
  // The 706px retained canvas at 125% becomes 564px at 100%. DockSide names
  // the expansion direction; native alignment names where the pill is painted.
  const cases: Array<{ side: DockSide; alignment: DockSide; oldX: number; newX: number }> = [
    { side: "left", alignment: "right", oldX: 621, newX: 516 },
    { side: "center", alignment: "center", oldX: 361, newX: 308 },
    { side: "right", alignment: "left", oldX: 100, newX: 100 },
  ];
  for (const { side, alignment, oldX, newX } of cases) {
    const request = (scale: number, windowWidth: number) => islandClipRequest({
      target: "idle", side, scale, windowX: 100, expandedY: 20,
      windowWidth, dockedEdges: ["top"],
    });
    expect(request(1.25, 706)).toEqual({
      x: oldX, y: 20, width: 185, height: 53, retainSurface: true,
      clip: { cornerRadius: 26, pad: 10, scaleFactor: 1.25, alignment, squareEdges: ["top"] },
    });
    expect(request(1, 564)).toEqual({
      x: newX, y: 20, width: 148, height: 42, retainSurface: true,
      clip: { cornerRadius: 21, pad: 8, scaleFactor: 1, alignment, squareEdges: ["top"] },
    });
  }
});
