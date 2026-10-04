import {
  getIslandGeometry,
  ISLAND_WINDOW_POLICY,
  type DockSide,
  type IslandMode,
} from "../islandModel";

export type SnapEdge = "top" | "right" | "bottom" | "left";

export interface SnapArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

export interface SnapResult {
  /** Snapped painted rect origin, physical px. Edges flush; bottom keeps edgeGutter. */
  x: number;
  y: number;
  edges: SnapEdge[];
  /** Drop landed in the top-center band — the caller centers x over the area. */
  centerHorizontally: boolean;
}

interface MonitorLike {
  workArea: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  };
  scaleFactor?: number;
}

export function snapAreaFromMonitor(monitor: MonitorLike): SnapArea {
  const { position, size } = monitor.workArea;
  return {
    left: position.x,
    top: position.y,
    right: position.x + size.width,
    bottom: position.y + size.height,
    width: size.width,
  };
}

/**
 * Drop-and-snap resolution against the work-area edges. `position`/`size` are
 * the painted island rect (see paintedIslandRect) in physical pixels — the
 * window can be much larger than the capsule it shows. Side/top snaps land
 * flush with the edge; bottom keeps the edge gutter; corners snap both axes.
 */
export function resolveEdgeSnap(
  position: { x: number; y: number },
  size: { width: number; height: number },
  area: SnapArea,
  scale: number,
  zones?: { top?: boolean; sides?: boolean; bottom?: boolean },
): SnapResult | null {
  const allowTop = zones?.top !== false;
  const allowSides = zones?.sides !== false;
  const allowBottom = zones?.bottom !== false;
  const topSnap = Math.round(ISLAND_WINDOW_POLICY.topSnapDistance * scale);
  const edgeSnap = Math.round(ISLAND_WINDOW_POLICY.edgeSnapDistance * scale);
  const edgeGutter = Math.round(ISLAND_WINDOW_POLICY.edgeGutter * scale);
  const topGutter = Math.round(ISLAND_WINDOW_POLICY.topGutter * scale);

  const edges: SnapEdge[] = [];
  let x = position.x;
  let y = position.y;
  let centerHorizontally = false;

  if (allowTop && position.y - area.top <= topSnap) {
    y = area.top + topGutter;
    edges.push("top");
    const band = Math.round(area.width * ISLAND_WINDOW_POLICY.topCenterSnapRatio);
    const center = area.left + area.width / 2;
    if (Math.abs(position.x + size.width / 2 - center) <= band) {
      centerHorizontally = true;
    }
  }
  if (allowSides && position.x - area.left <= edgeSnap) {
    x = area.left;
    edges.push("left");
  } else if (allowSides && area.right - (position.x + size.width) <= edgeSnap) {
    x = area.right - size.width;
    edges.push("right");
  }
  if (allowBottom && area.bottom - (position.y + size.height) <= edgeSnap) {
    y = area.bottom - size.height - edgeGutter;
    edges.push("bottom");
  }
  if (edges.length === 0) return null;
  return { x, y, edges, centerHorizontally };
}

export interface PaintedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Physical distance from the window's outer origin to the painted rect. */
  offsetX: number;
  offsetY: number;
}

/**
 * The island's painted rect in physical px. A collapsed island keeps a larger
 * retained canvas, so the surface is flex-anchored inside the window:
 * flush right when the island expands left, centered horizontally for center
 * docks, top-aligned in all cases. Window chrome counts as half on each side.
 */
export async function paintedIslandRect(
  win: {
    outerPosition(): Promise<{ x: number; y: number }>;
    outerSize(): Promise<{ width: number; height: number }>;
    innerSize(): Promise<{ width: number; height: number }>;
    scaleFactor(): Promise<number>;
  },
  mode: IslandMode,
  dockSide: DockSide,
): Promise<PaintedRect> {
  const [position, outerSize, innerSize, scale] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.innerSize(),
    win.scaleFactor(),
  ]);
  const geometry = getIslandGeometry(mode);
  const width = Math.round(geometry.width * scale);
  const height = Math.round(geometry.height * scale);
  const innerX = dockSide === "left"
    ? innerSize.width - width
    : dockSide === "center"
      ? Math.round((innerSize.width - width) / 2)
      : 0;
  const offsetX = Math.round((outerSize.width - innerSize.width) / 2) + innerX;
  const offsetY = Math.round((outerSize.height - innerSize.height) / 2);
  return {
    x: position.x + offsetX,
    y: position.y + offsetY,
    width,
    height,
    offsetX,
    offsetY,
  };
}
