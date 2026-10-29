import type { Hub, Vec } from "./types.ts";
import { V, add, clamp, mix, mul, rot } from "./math.ts";

/**
 * Shuyra Field — Symbol Morph 动态图标设计与实现规范
 *
 * Unifies the four global operation icons ("overview", "search", "history", "settings")
 * under one continuous geometric construction language built from Circle, Arc, Line, and Point
 * primitives parameterized by:
 *   - morph m ∈ [0, 1]: m = 0 (complete Line state) ↔ m = 1 (complete Circle state)
 *   - activity a ∈ [0, 1]: orthogonal interaction feedback (hover / focus / press / active)
 */

export type SymbolKind = "overview" | "search" | "history" | "settings";

export const SYMBOL_KINDS: readonly SymbolKind[] = [
  "overview",
  "search",
  "history",
  "settings",
] as const;

export interface PathGeometry {
  id: string;
  readonly d: string;
  points: readonly Vec[];
  role: "primary" | "secondary" | "guide";
  strokeScale?: number;
  opacity?: number;
}

export interface PointGeometry {
  id: string;
  x: number;
  y: number;
  r: number;
  role: "focus" | "endpoint" | "control";
  filled?: boolean;
  opacity?: number;
}

export interface SymbolOpticalToken {
  kind: SymbolKind;
  glyph: string;
  label: string;
  viewBox: "0 0 24 24";
  sizePx: 20;
  baseStrokeWidth: 1.8;
  hitSizePx: 44;
  /** Centralized optical scale around (12, 12) so all 4 icons share equal perceived size. */
  opticalScale: number;
  /** Centralized optical center-of-mass compensation in 24×24 grid coordinates. */
  opticalOffset: Vec;
  /** Stroke width delta added to baseStrokeWidth (1.8px) for density balance. */
  strokeCompensation: number;
}

export interface SymbolGeometry {
  kind: SymbolKind;
  morph: number;
  activity: number;
  optical: SymbolOpticalToken;
  paths: PathGeometry[];
  points: PointGeometry[];
}

export const SYMBOL_OPTICAL_TOKENS: Readonly<Record<SymbolKind, SymbolOpticalToken>> = {
  overview: {
    kind: "overview",
    glyph: "⊙",
    label: "全域观察",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    hitSizePx: 44,
    opticalScale: 1.0,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: 0,
  },
  search: {
    kind: "search",
    glyph: "⌕",
    label: "检索",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    hitSizePx: 44,
    opticalScale: 1.02,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: 0.02,
  },
  history: {
    kind: "history",
    glyph: "↶",
    label: "历史返回",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    hitSizePx: 44,
    opticalScale: 1.02,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: 0.04,
  },
  settings: {
    kind: "settings",
    glyph: "⚙",
    label: "设置",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    hitSizePx: 44,
    opticalScale: 0.99,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: -0.04,
  },
};

const GLYPH_TO_SYMBOL_KIND: Readonly<Record<string, SymbolKind>> = {
  "⊙": "overview",
  overview: "overview",
  "⌕": "search",
  search: "search",
  "↶": "history",
  back: "history",
  history: "history",
  "⚙": "settings",
  settings: "settings",
};

export function resolveSymbolKind(glyphOrId: string): SymbolKind | undefined {
  return GLYPH_TO_SYMBOL_KIND[glyphOrId];
}

/**
 * Convert a Hub's internal morph state (0 = circle, 1 = line) to the Symbol Morph
 * parameter m ∈ [0, 1] (where m = 1 is complete Circle state and m = 0 is complete Line state).
 * Reads directly from the Hub's instantaneous morph state without any independent timer.
 */
export function symbolMorphFromHub(hub: Pick<Hub, "morph">): number {
  return clamp(1 - hub.morph, 0, 1);
}

/** Analytic sin(x)/x without any division-by-zero singularity at x = 0. */
function sinc(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1e-4) {
    const x2 = x * x;
    return 1 - x2 / 6 + (x2 * x2) / 120;
  }
  return Math.sin(x) / x;
}

/** Analytic (1 - cos(x))/x without any division-by-zero singularity at x = 0. */
function cosc(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1e-4) {
    const x2 = x * x;
    return x / 2 - (x * x2) / 24 + (x * x2 * x2) / 720;
  }
  return (1 - Math.cos(x)) / x;
}

const fmt = (n: number): string => Number(n.toFixed(3)).toString();

function pointsToPathD(pts: readonly Vec[]): string {
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`)
    .join("");
}

/**
 * Evaluate a point on a constant-curvature Darboux arc at normalized parameter u ∈ [-1, 1].
 * - When halfAngle = 0: exact straight line segment of half-length `halfLength` along `angleRad`.
 * - When halfAngle > 0: exact circular arc of half-bending-angle `halfAngle`.
 * - `anchorMode`:
 *   - "endpoints": pins the endpoints u = ±1 to the baseline (y_local = 0) so two symmetric halves
 *     with halfAngle = π/2 form a closed circle centered at `center`.
 *   - "centroid": centers the arc's midpoint/chord around `center` so open arcs rotate/bend in place.
 */
export function evaluateDarbouxArcPoint(
  u: number,
  center: Vec,
  angleRad: number,
  halfLength: number,
  halfAngle: number,
  normalSign: 1 | -1 = 1,
  anchorMode: "endpoints" | "centroid" = "endpoints",
): { point: Vec; tangent: Vec; normal: Vec } {
  const theta = u * halfAngle;
  const localX = u * halfLength * sinc(theta);
  const baselineOffset =
    anchorMode === "endpoints"
      ? cosc(halfAngle)
      : 0.5 * cosc(halfAngle);
  const localY =
    normalSign * halfLength * (u * cosc(theta) - baselineOffset);
  const offset = rot(V(localX, localY), angleRad);
  const tangentAngle = angleRad + normalSign * theta;
  const tangent = V(Math.cos(tangentAngle), Math.sin(tangentAngle));
  const normal = V(-tangent.y, tangent.x);
  return {
    point: add(center, offset),
    tangent,
    normal,
  };
}

function sampleDarbouxArc(
  center: Vec,
  angleRad: number,
  halfLength: number,
  halfAngle: number,
  normalSign: 1 | -1 = 1,
  anchorMode: "endpoints" | "centroid" = "endpoints",
  steps = 24,
): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = -1 + (2 * i) / steps;
    pts.push(
      evaluateDarbouxArcPoint(
        u,
        center,
        angleRad,
        halfLength,
        halfAngle,
        normalSign,
        anchorMode,
      ).point,
    );
  }
  return pts;
}

/**
 * 1. 全域观察 (Overview):
 * - Circle state (m = 1): Concentric closed orbit + inner meridian arc + central focus point.
 * - Line state (m = 0): Horizontal datum axis, endpoints, central focus node, and orthogonal meridian tick.
 * - Interaction feedback (a ∈ [0, 1]): Orbit gently expands and central focus node responds.
 */
function evaluateOverviewSymbol(m: number, a: number): Omit<SymbolGeometry, "optical"> {
  const center = V(12, 12);
  const orbitR = 7.1 + 0.55 * a;
  const lineHalf = 7.4 + 0.5 * a;
  const halfAngle = m * (Math.PI / 2);
  const halfLen = mix(lineHalf, orbitR, m) / sinc(halfAngle);

  const upperCenter = V(12, 12 - (1 - m) * 5.4);
  const lowerCenter = V(12, 12 + (1 - m) * 5.4);
  const upperPts = sampleDarbouxArc(upperCenter, 0, halfLen, halfAngle, 1, "endpoints", 24);
  const lowerPts = sampleDarbouxArc(lowerCenter, 0, halfLen, halfAngle, -1, "endpoints", 24);

  // Inner concentric arc at m = 1 <-> orthogonal central meridian axis at m = 0
  const innerR = 4.2 + 0.35 * a;
  const innerLineHalf = 5.8 + 0.35 * a;
  const innerAngle = mix(-Math.PI / 2, 0, m);
  const innerHalfAngle = m * (Math.PI * 0.72);
  const innerHalfLen = mix(innerLineHalf, innerR * (Math.PI * 0.72), m);
  const innerPts = sampleDarbouxArc(
    center,
    innerAngle,
    innerHalfLen,
    innerHalfAngle,
    -1,
    "centroid",
    20,
  );

  const leftEnd = upperPts[0];
  const rightEnd = upperPts[upperPts.length - 1];

  return {
    kind: "overview",
    morph: m,
    activity: a,
    paths: [
      { id: "orbit-upper", points: upperPts, get d(): string { return pointsToPathD(this.points); }, role: "primary" },
      { id: "orbit-lower", points: lowerPts, get d(): string { return pointsToPathD(this.points); }, role: "primary" },
      {
        id: "inner-horizon",
        points: innerPts, get d(): string { return pointsToPathD(this.points); },
        role: "secondary",
        strokeScale: 0.88,
      },
    ],
    points: [
      {
        id: "focus-center",
        x: 12,
        y: 12,
        r: mix(2.05, 1.9, m) + 0.32 * a,
        role: "focus",
        filled: true,
      },
      {
        id: "endpoint-left",
        x: leftEnd.x,
        y: leftEnd.y,
        r: mix(1.45, 0.95, m) + 0.15 * a,
        role: "endpoint",
        filled: true,
      },
      {
        id: "endpoint-right",
        x: rightEnd.x,
        y: rightEnd.y,
        r: mix(1.45, 0.95, m) + 0.15 * a,
        role: "endpoint",
        filled: true,
      },
    ],
  };
}

/**
 * 2. 检索 (Search):
 * - Circle state (m = 1): Ring with eccentric focus point + local scanning arc + radial probe vector.
 * - Line state (m = 0): Linear track + parallel scanning segment + focusing node + orthogonal probe cursor.
 * - Interaction feedback (a ∈ [0, 1]): Focus point and scanning arc sweep along the scanning trajectory.
 */
function evaluateSearchSymbol(m: number, a: number): Omit<SymbolGeometry, "optical"> {
  const ringCenter = V(mix(12, 11.4, m), mix(13.2, 11.4, m));
  const ringR = 6.35;
  const trackHalf = 7.4;
  const halfAngle = m * (Math.PI / 2);
  const halfLen = mix(trackHalf, ringR, m) / sinc(halfAngle);

  const upperCenter = V(ringCenter.x, ringCenter.y - (1 - m) * 3.8);
  const lowerCenter = V(ringCenter.x, ringCenter.y + (1 - m) * 3.8);
  const upperPts = sampleDarbouxArc(upperCenter, 0, halfLen, halfAngle, 1, "endpoints", 24);
  const lowerPts = sampleDarbouxArc(lowerCenter, 0, halfLen, halfAngle, -1, "endpoints", 24);

  // Local scanning arc (m = 1) <-> upper linear scan rail (m = 0)
  const scanCenter = V(
    mix(12 + 1.1 * a, 11.4, m),
    mix(7.4, 11.4, m),
  );
  const scanRot = mix(0, -0.55 + 0.65 * a, m);
  const scanHalfAngle = m * 1.15;
  const scanHalfLen = mix(5.2, 3.85 * 1.15, m);
  const scanPts = sampleDarbouxArc(
    scanCenter,
    scanRot,
    scanHalfLen,
    scanHalfAngle,
    -1,
    "centroid",
    18,
  );

  // Eccentric focus point: glides along the linear track at m = 0 and orbits the eccentric scan ring at m = 1
  const focusAngle = -0.52 + 0.85 * a;
  const focusCirclePos = V(
    11.4 + 2.35 * Math.cos(focusAngle),
    11.4 + 2.35 * Math.sin(focusAngle),
  );
  const focusLinePos = V(13.2 + 2.3 * a, 13.2);
  const focusPos = V(
    mix(focusLinePos.x, focusCirclePos.x, m),
    mix(focusLinePos.y, focusCirclePos.y, m),
  );

  // Probe vector: connects the scan rail to the focus node at m = 0, and extends as the directional scan ray at m = 1
  const probeStart = V(
    mix(focusPos.x, 11.4 + ringR * Math.cos(Math.PI / 4), m),
    mix(6.4, 11.4 + ringR * Math.sin(Math.PI / 4), m),
  );
  const probeEnd = V(
    mix(focusPos.x, 19.3 + 0.45 * a, m),
    mix(17.6, 19.3 + 0.45 * a, m),
  );

  const leftAnchor = upperPts[0];

  return {
    kind: "search",
    morph: m,
    activity: a,
    paths: [
      { id: "track-upper", points: upperPts, get d(): string { return pointsToPathD(this.points); }, role: "primary" },
      { id: "track-lower", points: lowerPts, get d(): string { return pointsToPathD(this.points); }, role: "primary" },
      {
        id: "scan-arc",
        points: scanPts, get d(): string { return pointsToPathD(this.points); },
        role: "secondary",
        strokeScale: 0.9,
      },
      {
        id: "probe-line",
        points: [probeStart, probeEnd], get d(): string { return pointsToPathD(this.points); },
        role: "guide",
      },
    ],
    points: [
      {
        id: "eccentric-focus",
        x: focusPos.x,
        y: focusPos.y,
        r: 1.75 + 0.25 * a,
        role: "focus",
        filled: true,
      },
      {
        id: "track-origin",
        x: leftAnchor.x,
        y: leftAnchor.y,
        r: mix(1.3, 0.9, m),
        role: "endpoint",
        filled: true,
      },
    ],
  };
}

/**
 * 3. 历史返回 (History):
 * - Circle state (m = 1): Circumferential return-flow arc + reverse trajectory + tangent guide.
 * - Line state (m = 0): Axial fold-back line + reverse guide + return anchor node.
 * - Interaction feedback (a ∈ [0, 1]): Return trajectory shifts in reverse along the tangent/arc.
 */
function evaluateHistorySymbol(m: number, a: number): Omit<SymbolGeometry, "optical"> {
  const center = V(mix(12.2 - 0.8 * a, 12.2, m), mix(8.3, 14.2, m));
  const halfAngle = m * (Math.PI * 0.62);
  const radius = 6.6;
  const lineHalf = 6.8;
  const halfLen = mix(lineHalf, radius * Math.sin(Math.PI * 0.62), m) / sinc(halfAngle);
  const baseAngle = mix(0, 0.16 - 0.24 * a, m);

  const mainPts = sampleDarbouxArc(
    center,
    baseAngle,
    halfLen,
    halfAngle,
    1,
    "endpoints",
    24,
  );
  const headFrame = evaluateDarbouxArcPoint(
    -1,
    center,
    baseAngle,
    halfLen,
    halfAngle,
    1,
    "endpoints",
  );
  const tailFrame = evaluateDarbouxArcPoint(
    1,
    center,
    baseAngle,
    halfLen,
    halfAngle,
    1,
    "endpoints",
  );

  const wingLen = 3.25 + 0.25 * a;
  const wingSpread = 2.45;
  const wingUpper = add(
    headFrame.point,
    add(mul(headFrame.tangent, wingLen), mul(headFrame.normal, -wingSpread)),
  );
  const wingLower = add(
    headFrame.point,
    add(mul(headFrame.tangent, wingLen), mul(headFrame.normal, wingSpread)),
  );

  const foldCenter = V(mix(12.4, 12.2, m), mix(17.1, 14.5, m));
  const foldHalfAngle = m * (Math.PI * 0.46);
  const foldHalfLen = mix(5.4, 4.2 * Math.sin(Math.PI * 0.46), m) / sinc(foldHalfAngle);
  const foldPts = sampleDarbouxArc(
    foldCenter,
    baseAngle,
    foldHalfLen,
    foldHalfAngle,
    -1,
    "endpoints",
    16,
  );

  return {
    kind: "history",
    morph: m,
    activity: a,
    paths: [
      { id: "return-trajectory", points: mainPts, get d(): string { return pointsToPathD(this.points); }, role: "primary" },
      {
        id: "foldback-rail",
        points: foldPts, get d(): string { return pointsToPathD(this.points); },
        role: "secondary",
        strokeScale: 0.88,
      },
      {
        id: "reverse-guide",
        points: [wingUpper, headFrame.point, wingLower], get d(): string { return pointsToPathD(this.points); },
        role: "guide",
      },
    ],
    points: [
      {
        id: "head-node",
        x: headFrame.point.x,
        y: headFrame.point.y,
        r: 1.2 + 0.25 * a,
        role: "focus",
        filled: true,
      },
      {
        id: "origin-node",
        x: tailFrame.point.x,
        y: tailFrame.point.y,
        r: 1.45,
        role: "endpoint",
        filled: true,
      },
    ],
  };
}

function evaluateSettingsSymbol(m: number, a: number): Omit<SymbolGeometry, "optical"> {
  const ringR = 6.7;
  const sectorHalfAngle = m * (Math.PI / 3); // 3 * (2 * π/3) = 2π full ring at m = 1
  const lineHalfLen = 7.1;
  const halfLen = mix(lineHalfLen, ringR * Math.sin(Math.PI / 3), m) / sinc(sectorHalfAngle);

  const lineYs = [7.4, 12.0, 16.6];
  // Sector mid-angles on the circle: -90° (top), +30° (bottom-right), +150° (bottom-left)
  const sectorMidAngles = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
  // Tangent angles at the sector midpoints (perpendicular to the radial mid-angle)
  const sectorTangentAngles = [0, (2 * Math.PI) / 3, (-2 * Math.PI) / 3];
  const baseNodeParams = [-0.36, 0.34, -0.1];
  const nodeSlideDirs = [1, -1, 1];

  const paths: PathGeometry[] = [];
  const points: PointGeometry[] = [];

  for (let k = 0; k < 3; k++) {
    const midAngle = sectorMidAngles[k];
    // In Circle state (m = 1), for a sector of half-angle π/3 with endpoints pinned to chord,
    // the chord midpoint is at distance ringR * cos(π/3) = 0.5 * ringR from (12, 12).
    const circleChordCenter = V(
      12 + ringR * Math.cos(Math.PI / 3) * Math.cos(midAngle),
      12 + ringR * Math.cos(Math.PI / 3) * Math.sin(midAngle),
    );
    const lineCenter = V(12, lineYs[k]);
    const center = V(
      mix(lineCenter.x, circleChordCenter.x, m),
      mix(lineCenter.y, circleChordCenter.y, m),
    );
    const tangentAngle = mix(0, sectorTangentAngles[k], m);

    const pts = sampleDarbouxArc(
      center,
      tangentAngle,
      halfLen,
      sectorHalfAngle,
      1,
      "endpoints",
      16,
    );
    paths.push({
      id: `track-${k}`,
      points: pts, get d(): string { return pointsToPathD(this.points); },
      role: "primary",
    });

    const nodeU = clamp(
      baseNodeParams[k] + nodeSlideDirs[k] * 0.34 * a,
      -0.78,
      0.78,
    );
    const nodeFrame = evaluateDarbouxArcPoint(
      nodeU,
      center,
      tangentAngle,
      halfLen,
      sectorHalfAngle,
      1,
      "endpoints",
    );
    points.push({
      id: `control-${k}`,
      x: nodeFrame.point.x,
      y: nodeFrame.point.y,
      r: 1.68 + 0.18 * a,
      role: "control",
      filled: true,
    });
  }

  return {
    kind: "settings",
    morph: m,
    activity: a,
    paths,
    points,
  };
}

/**
 * Pure geometric evaluator for the 4 global operation symbols.
 * @param kind - "overview" | "search" | "history" | "settings"
 * @param morph - m ∈ [0, 1], where m = 0 is pure Line state and m = 1 is pure Circle state.
 * @param activity - a ∈ [0, 1], independent interaction feedback parameter (default 0).
 */
export function evaluateSymbol(
  kind: SymbolKind,
  morph: number,
  activity = 0,
): SymbolGeometry {
  const m = clamp(Number.isFinite(morph) ? morph : 1, 0, 1);
  const a = clamp(Number.isFinite(activity) ? activity : 0, 0, 1);
  const optical = SYMBOL_OPTICAL_TOKENS[kind];
  if (!optical) {
    throw new Error(`Unknown SymbolKind: ${String(kind)}`);
  }
  switch (kind) {
    case "overview":
      return { ...evaluateOverviewSymbol(m, a), optical };
    case "search":
      return { ...evaluateSearchSymbol(m, a), optical };
    case "history":
      return { ...evaluateHistorySymbol(m, a), optical };
    case "settings":
      return { ...evaluateSettingsSymbol(m, a), optical };
  }
}

/**
 * Compute the bounding box and visual centroid of a SymbolGeometry across all its path samples
 * and points, used by automated tests to verify optical consistency and centroid stability.
 */
export function measureSymbolBounds(geometry: SymbolGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const path of geometry.paths) {
    for (const point of path.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  for (const pt of geometry.points) {
    xs.push(pt.x - pt.r, pt.x + pt.r);
    ys.push(pt.y - pt.r, pt.y + pt.r);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}
