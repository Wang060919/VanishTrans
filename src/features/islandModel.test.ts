import { describe, expect, it } from "vitest";
import {
  chooseDockSide,
  getExpandedX,
  getIdleAnchorX,
  getIslandGeometry,
  hasSameGeometry,
  shrinksIsland,
} from "./islandModel";

describe("islandModel", () => {
  it("keeps every geometry in one shared model", () => {
    expect(getIslandGeometry("idle")).toEqual({ width: 116, height: 42, borderRadius: 21 });
    expect(getIslandGeometry("full")).toEqual({ width: 720, height: 380, borderRadius: 28 });
    expect(hasSameGeometry("peek", "actions")).toBe(true);
    expect(shrinksIsland("full", "status")).toBe(true);
    expect(shrinksIsland("idle", "full")).toBe(false);
  });

  it.each(["left", "center", "right"] as const)(
    "round-trips the idle anchor when docked to %s",
    (side) => {
      const expandedX = getExpandedX(side, 902, 116, 720);
      expect(getIdleAnchorX(side, expandedX, 720, 116)).toBe(902);
    },
  );

  it("chooses an edge dock when the full island cannot remain centered", () => {
    expect(chooseDockSide(16, 116, 720, 0, 1920, 8)).toBe("right");
    expect(chooseDockSide(1788, 116, 720, 0, 1920, 8)).toBe("left");
    expect(chooseDockSide(902, 116, 720, 0, 1920, 8)).toBe("center");
  });
});
