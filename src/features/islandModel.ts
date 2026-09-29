export type DockSide = "left" | "center" | "right";
export type BallAction = "clipboard" | "screenshot" | "main";
export type IslandMode = "idle" | "peek" | "actions" | "status" | "result" | "full";
export type IslandPhase = "working" | "done" | "error" | "idle";
export type IslandMotion = "animated" | "instant";
export type IslandVisualPhase = "stable" | "full-exit";

export interface IslandGeometry {
  width: number;
  height: number;
  borderRadius: number;
}

export interface IslandPresentation {
  mode: IslandMode;
  motion: IslandMotion;
  phase: IslandVisualPhase;
  generation: number;
}

export const ISLAND_GEOMETRY: Record<IslandMode, IslandGeometry> = {
  idle: { width: 116, height: 42, borderRadius: 21 },
  peek: { width: 224, height: 48, borderRadius: 24 },
  actions: { width: 224, height: 48, borderRadius: 24 },
  status: { width: 232, height: 48, borderRadius: 24 },
  result: { width: 392, height: 176, borderRadius: 28 },
  full: { width: 560, height: 540, borderRadius: 28 },
};

export const ISLAND_TIMING = {
  surfaceMs: 360,
  compactMs: 300,
  resultMs: 340,
  collapseMs: 260,
  fullContentEnterDelayMs: 70,
  fullContentEnterMs: 240,
  fullContentExitMs: 90,
  idleWordmarkDelayMs: 220,
} as const;

/** Shared by CSS, compact content and native clipping to avoid early cuts. */
export function getIslandSurfaceMs(mode: IslandMode) {
  if (mode === "idle") return ISLAND_TIMING.collapseMs;
  if (mode === "full") return ISLAND_TIMING.surfaceMs;
  return mode === "result" ? ISLAND_TIMING.resultMs : ISLAND_TIMING.compactMs;
}

export const ISLAND_WINDOW_POLICY = {
  edgeGutter: 8,
  topGutter: 0,
  topSnapDistance: 32,
} as const;

export function getIslandGeometry(mode: IslandMode): IslandGeometry {
  return ISLAND_GEOMETRY[mode];
}

export function hasSameGeometry(first: IslandMode, second: IslandMode) {
  const firstGeometry = getIslandGeometry(first);
  const secondGeometry = getIslandGeometry(second);
  return firstGeometry.width === secondGeometry.width
    && firstGeometry.height === secondGeometry.height;
}

export function shrinksIsland(previous: IslandMode, target: IslandMode) {
  const previousGeometry = getIslandGeometry(previous);
  const targetGeometry = getIslandGeometry(target);
  return targetGeometry.width <= previousGeometry.width
    && targetGeometry.height <= previousGeometry.height
    && (targetGeometry.width < previousGeometry.width
      || targetGeometry.height < previousGeometry.height);
}

export function getExpandedX(
  side: DockSide,
  anchorX: number,
  idleOuterWidth: number,
  expandedOuterWidth: number,
) {
  if (side === "center") {
    return Math.round(anchorX + (idleOuterWidth - expandedOuterWidth) / 2);
  }
  return side === "left"
    ? anchorX + idleOuterWidth - expandedOuterWidth
    : anchorX;
}

export function getIdleAnchorX(
  side: DockSide,
  expandedX: number,
  expandedOuterWidth: number,
  idleOuterWidth: number,
) {
  if (side === "center") {
    return Math.round(expandedX + (expandedOuterWidth - idleOuterWidth) / 2);
  }
  return side === "left"
    ? expandedX + expandedOuterWidth - idleOuterWidth
    : expandedX;
}

export function chooseDockSide(
  anchorX: number,
  idleOuterWidth: number,
  preferredOuterWidth: number,
  monitorLeft: number,
  monitorRight: number,
  gutter: number,
): DockSide {
  const minX = monitorLeft + gutter;
  const maxRight = monitorRight - gutter;
  const centeredX = getExpandedX("center", anchorX, idleOuterWidth, preferredOuterWidth);
  if (centeredX >= minX && centeredX + preferredOuterWidth <= maxRight) {
    return "center";
  }

  const leftX = getExpandedX("left", anchorX, idleOuterWidth, preferredOuterWidth);
  const canExpandLeft = leftX >= minX;
  const canExpandRight = anchorX + preferredOuterWidth <= maxRight;
  if (canExpandLeft || !canExpandRight) return "left";
  return "right";
}
