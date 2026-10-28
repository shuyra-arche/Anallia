import type { Theme, Vec } from "../core/types.ts";
import type { LoadingPhase } from "../core/loading.ts";
import { clamp, mix, quint } from "../core/math.ts";

/**
 * V24 loading geometry. The three mutually tangent circles and the Möbius
 * traversal are kept as numeric primitives; renderers never receive or parse
 * SVG path data from this module.
 */

const PI = Math.PI;
const TAU = PI * 2;

export const L_C = [-9 / 14, -2 / 7, 3 / 7] as const;
export const L_RADII = [140, 70, 35] as const;
export const LOADING_VIEWBOX_SIZE = 440;
export const LOADING_CENTER = { x: 220, y: 220 } as const;
export const LOADING_RING_RADIUS = 140;

export const L_DUR = {
  intro: 1.55,
  introArc: 0.58,
  loop: 5.45,
  outroArc: 0.58,
  outro: 1.55,
} as const;

export const L_LOOP = {
  leftTailEnd: 0.72,
  morphStart: 0.58,
  morphEnd: 3.04,
  rightHeadStart: 2.9,
  rightHeadEnd: 3.62,
  rightTailEnd: 4.28,
  rotateStart: 4.1,
  rotateEnd: 6.16,
  leftHeadStart: 5.98,
  leftHeadEnd: 6.82,
} as const;

/** Time used for the non-animated posture under reduced motion. */
export const LOADING_STATIC_TIME = L_DUR.intro + L_DUR.introArc;

export type LoadingSide = "left" | "right";
export type LoadingTone = "ink" | "arc" | "fine" | "shimmer";

export interface LoadingPlacement {
  /** Material anchor in the backend's target coordinate space. */
  anchor: Vec;
  /** Rotation around the anchor, in radians. */
  angle: number;
  scale: number;
  /** Injected theme key; evaluating geometry never changes the document theme. */
  theme: Theme;
}

export interface LoadingPlacementInput {
  anchor?: Vec;
  angle?: number;
  scale?: number;
  theme?: Theme;
}

export interface LoadingCircle {
  kind: "circle";
  id: string;
  index: number;
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  tone: LoadingTone;
  weight: number;
}

export interface LoadingArc {
  kind: "arc";
  id: string;
  index: number;
  cx: number;
  cy: number;
  r: number;
  /** Radians in the backend's y-down coordinate space. */
  startAngle: number;
  endAngle: number;
  clockwise: true;
  opacity: number;
  tone: LoadingTone;
  weight: number;
}

export interface LoadingPolyline {
  kind: "polyline";
  id: string;
  index: number;
  points: Vec[];
  closed: boolean;
  opacity: number;
  tone: LoadingTone;
  weight: number;
}

export type LoadingShape = LoadingCircle | LoadingArc | LoadingPolyline;

export interface LoadingGeometry {
  time: number;
  phase: LoadingPhase;
  placement: LoadingPlacement;
  theme: Theme;
  opacity: number;
  exit: number;
  streaming: boolean;
  reducedMotion: boolean;
  circles: LoadingCircle[];
  arcs: LoadingArc[];
  points: LoadingPolyline[];
}

export interface LoadingGeometryOptions {
  placement?: LoadingPlacementInput;
  phase?: LoadingPhase;
  exit?: number;
  streaming?: boolean;
  reducedMotion?: boolean;
  opacity?: number;
}

export interface LoadingPose {
  circles: LoadingCircle[];
  arcs: LoadingArc[];
  points: LoadingPolyline[];
}

const normalize = (value: number, a: number, b: number): number =>
  clamp((value - a) / (b - a), 0, 1);

const finite = (value: number): boolean => Number.isFinite(value);

const numberOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && finite(value) ? value : fallback;

function complexMul(
  ar: number,
  ai: number,
  br: number,
  bi: number,
): [number, number] {
  return [ar * br - ai * bi, ar * bi + ai * br];
}

function complexDiv(
  ar: number,
  ai: number,
  br: number,
  bi: number,
): [number, number] {
  const d = br * br + bi * bi || 1e-9;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}

export function loadingCurvatureParameter(s: number): number {
  const a = Math.abs(s);
  return s * (0.43 + 0.57 * a * a);
}

/** The complex inversion used by the V24 main transform. */
export function loadingMobiusPoint(s: number, c: number, y: number): Vec {
  const phi = (PI / 2) * (1 - s);
  const q = loadingCurvatureParameter(s);
  const qr = q * Math.cos(phi);
  const qi = q * Math.sin(phi);
  const beta = s * s * phi;
  const nr = 100 * Math.cos(beta);
  const ni = 100 * Math.sin(beta);
  const [a, b] = complexMul(nr, ni, c, y);
  const [x, z] = complexDiv(a, b, 1 + qr * c - qi * y, qr * y + qi * c);
  return { x: 220 + 40 * s + x, y: 220 + z };
}

/** Circle osculating the transformed line at parameter `s`, circle index `i`. */
export function loadingCurve(
  s: number,
  i: number,
): { cx: number; cy: number; r: number } {
  if (Math.abs(s) < 1e-9) return { cx: NaN, cy: NaN, r: Infinity };
  const c = L_C[i];
  const phi = (PI / 2) * (1 - s);
  const q = loadingCurvatureParameter(s);
  const qsR = q * Math.cos(phi);
  const qsI = q * Math.sin(phi);
  const beta = s * s * phi;
  const BRe = 100 * Math.cos(beta);
  const BIm = 100 * Math.sin(beta);
  const ARe = 220 + 40 * s;
  const AIm = 220;
  const invq = complexDiv(1, 0, qsR, qsI);
  const Bq = complexDiv(BRe, BIm, qsR, qsI);
  const Q0 = ARe + Bq[0];
  const Q1 = AIm + Bq[1];
  const D = complexDiv(Bq[0], Bq[1], qsR, qsI);
  const dist = c + invq[0];
  return {
    cx: Q0 - D[0] / (2 * dist),
    cy: Q1 - D[1] / (2 * dist),
    r: 100 / (2 * q * q * Math.abs(dist)),
  };
}

export function loadingLinePoints(s: number, i: number, segments = 80): Vec[] {
  const points: Vec[] = [];
  const count = Math.max(1, Math.floor(segments));
  for (let j = 0; j <= count; j++) {
    const y = -8 + (16 * j) / count;
    points.push(loadingMobiusPoint(s, L_C[i], y));
  }
  return points;
}

export function loadingStableCircle(
  side: LoadingSide,
  i: number,
): { cx: number; cy: number; r: number } {
  const r = L_RADII[i];
  return { cx: side === "left" ? 80 + r : 360 - r, cy: 220, r };
}

export function loadingRotateCircle(
  circle: { cx: number; cy: number; r: number },
  theta: number,
): { cx: number; cy: number; r: number } {
  const dx = circle.cx - 220;
  const dy = circle.cy - 220;
  return {
    cx: 220 + dx * Math.cos(theta) - dy * Math.sin(theta),
    cy: 220 + dx * Math.sin(theta) + dy * Math.cos(theta),
    r: circle.r,
  };
}

const circleAt = (
  id: string,
  index: number,
  cx: number,
  cy: number,
  r: number,
  tone: LoadingTone,
  weight: number,
  opacity = 1,
): LoadingCircle => ({
  kind: "circle",
  id,
  index,
  cx,
  cy,
  r,
  opacity,
  tone,
  weight,
});

const arcAt = (
  id: string,
  index: number,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  tone: LoadingTone,
  weight: number,
  opacity = 1,
): LoadingArc => ({
  kind: "arc",
  id,
  index,
  cx,
  cy,
  r,
  startAngle,
  endAngle,
  clockwise: true,
  opacity,
  tone,
  weight,
});

const polylineAt = (
  id: string,
  index: number,
  points: Vec[],
  tone: LoadingTone,
  weight: number,
  opacity = 1,
): LoadingPolyline => ({
  kind: "polyline",
  id,
  index,
  points,
  closed: false,
  opacity,
  tone,
  weight,
});

function addStableCircles(pose: LoadingPose, side: LoadingSide): void {
  for (let i = 0; i < 3; i++) {
    const circle = loadingStableCircle(side, i);
    pose.circles.push(
      circleAt(`circle${i}`, i, circle.cx, circle.cy, circle.r, "ink", 6),
    );
  }
}

function addDrawnCircles(
  pose: LoadingPose,
  side: LoadingSide,
  progress: readonly number[],
): void {
  for (let i = 0; i < 3; i++) {
    const circle = loadingStableCircle(side, i);
    const p = progress[i];
    if (p <= 1e-5) continue;
    if (p >= 0.99999) {
      pose.circles.push(
        circleAt(`circle${i}`, i, circle.cx, circle.cy, circle.r, "ink", 6),
      );
    } else {
      const start = side === "left" ? PI : 0;
      pose.arcs.push(
        arcAt(
          `circle${i}`,
          i,
          circle.cx,
          circle.cy,
          circle.r,
          start,
          start + TAU * p,
          "ink",
          6,
        ),
      );
    }
    addPenTip(pose, circle, side, p, i);
  }
}

function addPenTip(
  pose: LoadingPose,
  circle: { cx: number; cy: number; r: number },
  side: LoadingSide,
  p: number,
  index: number,
): void {
  if (p <= 0.07 || p >= 0.995) return;
  const start = (side === "left" ? PI : 0) + TAU * Math.max(0, p - 0.095);
  const end = (side === "left" ? PI : 0) + TAU * p;
  const points: Vec[] = [];
  for (let j = 0; j <= 12; j++) {
    const angle = mix(start, end, j / 12);
    points.push({
      x: circle.cx + circle.r * Math.cos(angle),
      y: circle.cy + circle.r * Math.sin(angle),
    });
  }
  pose.points.push(polylineAt(`tip${index}`, index, points, "shimmer", 1.55));
}

function addArcs(
  pose: LoadingPose,
  side: LoadingSide,
  tail: number,
  head: number,
): void {
  const length = Math.max(0, head - tail);
  if (length < 0.0005) return;
  const opacity = clamp(length / 0.04, 0, 1);
  for (let i = 0; i < 2; i++) {
    const meta =
      side === "right"
        ? i === 0
          ? { cx: 360, cy: 80, a0: PI / 2, a1: PI }
          : { cx: 80, cy: 360, a0: -PI / 2, a1: 0 }
        : i === 0
          ? { cx: 80, cy: 360, a0: -PI / 2, a1: 0 }
          : { cx: 360, cy: 80, a0: PI / 2, a1: PI };
    const start = mix(meta.a0, meta.a1, clamp(tail, 0, 1));
    const end = mix(meta.a0, meta.a1, clamp(head, 0, 1));
    pose.arcs.push(
      arcAt(
        `mark${i}`,
        i,
        meta.cx,
        meta.cy,
        LOADING_RING_RADIUS,
        start,
        end,
        "arc",
        6,
        opacity,
      ),
    );
    pose.arcs.push(
      arcAt(
        `arc-fine${i}`,
        i,
        meta.cx,
        meta.cy,
        LOADING_RING_RADIUS,
        start,
        end,
        "fine",
        1.05,
        opacity * 0.3,
      ),
    );
  }
}

function addStraightCluster(pose: LoadingPose, s: number): void {
  for (let i = 0; i < 3; i++) {
    const points = loadingLinePoints(s, i);
    pose.points.push(polylineAt(`straight${i}`, i, points, "ink", 6));
  }
}

function addMorphShapes(pose: LoadingPose, s: number): void {
  if (Math.abs(s) < 0.065) {
    addStraightCluster(pose, s);
    return;
  }
  const side: LoadingSide = s < 0 ? "left" : "right";
  for (let i = 0; i < 3; i++) {
    const circle =
      Math.abs(s) >= 1 - 1e-9
        ? loadingStableCircle(side, i)
        : loadingCurve(s, i);
    if (!finite(circle.cx) || !finite(circle.cy) || !finite(circle.r)) {
      const fallback = loadingLinePoints(s, i);
      pose.points.push(polylineAt(`straight${i}`, i, fallback, "ink", 6));
      continue;
    }
    if (circle.r < 600) {
      pose.circles.push(
        circleAt(`circle${i}`, i, circle.cx, circle.cy, circle.r, "ink", 6),
      );
      continue;
    }
    const mid = loadingMobiusPoint(s, L_C[i], 0);
    const base = Math.atan2(mid.y - circle.cy, mid.x - circle.cx);
    const a = Math.abs(s);
    const raw = Math.min(
      PI * 0.985,
      (210 / circle.r) * (1 + 0.45 * a) + PI * a * a * a * a,
    );
    const closeEnd = quint(normalize(a, 0.92, 1));
    const closeRad = 1 - quint(normalize(circle.r, 600, 850));
    const delta = mix(raw, PI, Math.max(closeEnd, closeRad));
    pose.arcs.push(
      arcAt(
        `circle${i}`,
        i,
        circle.cx,
        circle.cy,
        circle.r,
        base - delta,
        base + delta,
        "ink",
        6,
      ),
    );
  }
}

function addRotatedStable(pose: LoadingPose, theta: number): void {
  for (let i = 0; i < 3; i++) {
    const circle = loadingRotateCircle(loadingStableCircle("right", i), theta);
    pose.circles.push(
      circleAt(`circle${i}`, i, circle.cx, circle.cy, circle.r, "ink", 6),
    );
  }
}

/** Local 440×440 pose before placement. Useful for diagnostics and tests. */
export function evaluateLoadingPose(time: number): LoadingPose {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  const pose: LoadingPose = { circles: [], arcs: [], points: [] };
  if (t < L_DUR.intro) {
    const p = quint(t / L_DUR.intro);
    const progress = [
      clamp(p / 0.34, 0, 1),
      clamp((p - 0.34) / 0.32, 0, 1),
      clamp((p - 0.66) / 0.34, 0, 1),
    ].map(quint);
    addDrawnCircles(pose, "left", progress);
    return pose;
  }
  if (t < L_DUR.intro + L_DUR.introArc) {
    addStableCircles(pose, "left");
    addArcs(pose, "left", 0, quint((t - L_DUR.intro) / L_DUR.introArc));
    return pose;
  }

  const loopPhase = (t - L_DUR.intro - L_DUR.introArc) % L_DUR.loop;
  const l = (loopPhase / L_DUR.loop) * L_LOOP.leftHeadEnd;
  const leftTail = quint(normalize(l, 0, L_LOOP.leftTailEnd));
  const s = -1 + 2 * quint(normalize(l, L_LOOP.morphStart, L_LOOP.morphEnd));
  const rightHead = quint(
    normalize(l, L_LOOP.rightHeadStart, L_LOOP.rightHeadEnd),
  );
  const rightTail = quint(
    normalize(l, L_LOOP.rightHeadEnd, L_LOOP.rightTailEnd),
  );
  const rotP = quint(normalize(l, L_LOOP.rotateStart, L_LOOP.rotateEnd));
  const leftHead = quint(
    normalize(l, L_LOOP.leftHeadStart, L_LOOP.leftHeadEnd),
  );

  if (l < L_LOOP.morphStart) {
    addStableCircles(pose, "left");
    addArcs(pose, "left", leftTail, 1);
  } else if (l < L_LOOP.morphEnd) {
    addMorphShapes(pose, s);
    if (l < L_LOOP.leftTailEnd) addArcs(pose, "left", leftTail, 1);
    else if (l > L_LOOP.rightHeadStart) addArcs(pose, "right", 0, rightHead);
  } else if (l < L_LOOP.rotateStart) {
    addStableCircles(pose, "right");
    if (l < L_LOOP.rightHeadEnd) addArcs(pose, "right", 0, rightHead);
    else addArcs(pose, "right", rightTail, 1);
  } else if (l < L_LOOP.rotateEnd) {
    addRotatedStable(pose, PI * rotP);
    if (l < L_LOOP.rightTailEnd) addArcs(pose, "right", rightTail, 1);
    else if (l > L_LOOP.leftHeadStart) addArcs(pose, "left", 0, leftHead);
  } else {
    addStableCircles(pose, "left");
    addArcs(pose, "left", 0, leftHead);
  }
  return pose;
}

const resolvePlacement = (
  input: LoadingPlacementInput | undefined,
): LoadingPlacement => ({
  anchor: {
    x: numberOr(input?.anchor?.x, 220),
    y: numberOr(input?.anchor?.y, 220),
  },
  angle: numberOr(input?.angle, 0),
  scale: Math.max(1e-6, numberOr(input?.scale, 1)),
  theme: input?.theme ?? "light",
});

function placePoint(
  point: Vec,
  placement: LoadingPlacement,
  scale: number,
): Vec {
  const dx = (point.x - 220) * scale;
  const dy = (point.y - 220) * scale;
  const c = Math.cos(placement.angle);
  const s = Math.sin(placement.angle);
  return {
    x: placement.anchor.x + dx * c - dy * s,
    y: placement.anchor.y + dx * s + dy * c,
  };
}

/**
 * Evaluate V24 geometry for a time (seconds since first visible frame) and an
 * injected material placement. The result is already positioned by the anchor,
 * angle and scale; `theme` is echoed for the backend and is never applied to
 * the document.
 */
export function evaluateLoadingGeometry(
  time: number,
  options: LoadingGeometryOptions = {},
): LoadingGeometry {
  const placement = resolvePlacement(options.placement);
  const reducedMotion = options.reducedMotion === true;
  const effectiveTime = reducedMotion
    ? LOADING_STATIC_TIME
    : Math.max(0, Number.isFinite(time) ? time : 0);
  const phase = options.phase ?? "waiting";
  const exit = clamp(finite(options.exit ?? NaN) ? options.exit! : 0, 0, 1);
  const exitEase = quint(exit);
  const collapse = 1 - 0.12 * exitEase;
  const opacity = clamp(
    (finite(options.opacity ?? NaN) ? options.opacity! : 1) * (1 - exitEase),
    0,
    1,
  );
  const pose = evaluateLoadingPose(effectiveTime);
  const radiusScale = placement.scale * collapse;

  const circles = pose.circles.map((circle) => {
    const center = placePoint(
      { x: circle.cx, y: circle.cy },
      placement,
      radiusScale,
    );
    return {
      ...circle,
      cx: center.x,
      cy: center.y,
      r: circle.r * radiusScale,
      opacity: clamp(circle.opacity * opacity, 0, 1),
    };
  });
  const arcs = pose.arcs.map((arc) => {
    const center = placePoint({ x: arc.cx, y: arc.cy }, placement, radiusScale);
    return {
      ...arc,
      cx: center.x,
      cy: center.y,
      r: arc.r * radiusScale,
      startAngle: arc.startAngle + placement.angle,
      endAngle: arc.endAngle + placement.angle,
      opacity: clamp(arc.opacity * opacity, 0, 1),
    };
  });
  const points = pose.points.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) =>
      placePoint(point, placement, radiusScale),
    ),
    opacity: clamp(polyline.opacity * opacity, 0, 1),
  }));

  return {
    time: effectiveTime,
    phase,
    placement,
    theme: placement.theme,
    opacity,
    exit,
    streaming: options.streaming === true,
    reducedMotion,
    circles,
    arcs,
    points,
  };
}

/** Fixed back-to-front layer order for SVG/GPU backends. */
export function loadingShapes(geometry: LoadingGeometry): LoadingShape[] {
  const layer = (shape: LoadingShape): number => {
    if (shape.kind === "polyline") return shape.tone === "shimmer" ? 4 : 3;
    if (shape.tone === "arc") return 0;
    if (shape.tone === "fine") return 1;
    return 2;
  };
  return [...geometry.arcs, ...geometry.circles, ...geometry.points].sort(
    (a, b) => layer(a) - layer(b) || a.index - b.index,
  );
}

export { PI as LOADING_PI, TAU as LOADING_TAU };
