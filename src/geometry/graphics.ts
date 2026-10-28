import type { Camera, Hub, Passage, Vec, Viewport } from "../core/types.ts";
import {
  material,
  nodeS,
  screenToWorld,
  worldToScreen,
  asWorld,
  R,
  shapeU,
} from "./field.ts";
import { arcLengthAt } from "./field.ts";
import { clamp, mix, rot } from "../core/math.ts";
import type {
  ArcPrimitive,
  PolylinePrimitive,
  ShapeStyle,
} from "../core/graphics.ts";

/** Screen-space numeric representation of a hub curve. */
export interface NumericCircle {
  kind: "circle";
  cx: number;
  cy: number;
  radius: number;
}

export interface NumericPolyline {
  kind: "polyline";
  points: Vec[];
  closed?: boolean;
}

export type NumericCurve = NumericCircle | NumericPolyline;

export interface CurveClip {
  curve: NumericCurve;
  outerRect?: { x: number; y: number; width: number; height: number };
  rule: "nonzero" | "evenodd";
}

export interface PortalGeometry {
  stroke: NumericCurve;
  boundary: CurveClip;
  /** Delayed echo used by remote/axis crossings. */
  echo: NumericCurve | null;
}

const anchorX = (u: number): number =>
  R * (1 - 2 * easeClamped(u - 1));

function easeClamped(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function viewportCorners(viewport: Viewport): Vec[] {
  return [
    { x: -260, y: -260 },
    { x: viewport.width + 260, y: -260 },
    { x: viewport.width + 260, y: viewport.height + 260 },
    { x: -260, y: viewport.height + 260 },
  ];
}

function lineSampleRange(
  hub: Hub,
  camera: Camera,
  viewport: Viewport,
  radius: number,
): { lo: number; hi: number } {
  const corners = viewportCorners(viewport).map((p) =>
    rot(
      {
        x: screenToWorld(p, camera, viewport).x - hub.center.x,
        y: screenToWorld(p, camera, viewport).y - hub.center.y,
      },
      (-hub.angle * Math.PI) / 180,
    ),
  );
  return {
    lo: Math.max(-radius, Math.min(...corners.map((p) => p.y)) - 400),
    hi: Math.min(radius, Math.max(...corners.map((p) => p.y)) + 400),
  };
}

/**
 * Extract the generalized-circle hub geometry as either one exact screen circle
 * or a finite screen-space point list. The finite branch deliberately reuses the
 * historical line-singularity clipping strategy: sample only the visible y band,
 * then close the sweep to a far screen-space anchor for the mask.
 */
export function evaluateHubCurve(
  hub: Hub,
  camera: Camera,
  viewport: Viewport,
  u = shapeU(hub),
): NumericCurve {
  const d = 1 - u;
  const radius = Math.abs(d) < 1e-5 ? 1e7 : R / Math.abs(d);
  const screenRadius = radius * camera.z;
  const x0 = anchorX(u);
  const project = (p: Vec): Vec =>
    worldToScreen(asWorld(hub, p), camera, viewport);
  if (screenRadius < Math.max(1600, viewport.width * 1.75)) {
    const p0 = project({ x: x0, y: 0 });
    const p1 = project({ x: x0 - (2 * R) / d, y: 0 });
    return {
      kind: "circle",
      cx: (p0.x + p1.x) / 2,
      cy: (p0.y + p1.y) / 2,
      radius: screenRadius,
    };
  }
  const { lo, hi } = lineSampleRange(hub, camera, viewport, radius);
  if (!(lo < hi)) return { kind: "polyline", points: [] };
  const steps = Math.max(
    28,
    Math.min(180, Math.ceil(((hi - lo) * camera.z) / 8)),
  );
  const points: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = mix(lo, hi, i / steps);
    const x =
      Math.abs(d) < 1e-5
        ? x0
        : x0 -
          (d * y * y) /
            (R * (1 + Math.sqrt(Math.max(0, 1 - (y / radius) ** 2))));
    const p = project({ x, y });
    if (Number.isFinite(p.x + p.y)) points.push(p);
  }
  return { kind: "polyline", points };
}

export function evaluateHubCurveClip(
  hub: Hub,
  camera: Camera,
  viewport: Viewport,
  u = shapeU(hub),
): CurveClip {
  const d = 1 - u;
  const radius = Math.abs(d) < 1e-5 ? 1e7 : R / Math.abs(d);
  const screenRadius = radius * camera.z;
  const curve = evaluateHubCurve(hub, camera, viewport, u);
  if (
    screenRadius <
    Math.max(1600, viewport.width * 1.75)
  ) {
    return {
      curve,
      outerRect:
        d > 0
          ? undefined
          : {
              x: -200,
              y: -200,
              width: viewport.width + 400,
              height: viewport.height + 400,
            },
      rule: "evenodd",
    };
  }
  const { lo, hi } = lineSampleRange(hub, camera, viewport, radius);
  if (!(lo < hi) || curve.kind !== "polyline") {
    return { curve, rule: "nonzero" };
  }
  const x0 = anchorX(u);
  const a = worldToScreen(asWorld(hub, { x: x0 - 5000, y: hi }), camera, viewport);
  const b = worldToScreen(asWorld(hub, { x: x0 - 5000, y: lo }), camera, viewport);
  return {
    curve: {
      kind: "polyline",
      points: [...curve.points, a, b],
      closed: true,
    },
    rule: "nonzero",
  };
}

export function evaluateHubAuraCurve(
  hub: Hub,
  camera: Camera,
  viewport: Viewport,
  offset: number,
  u = shapeU(hub),
): NumericCurve {
  const d = 1 - u;
  const radius = Math.abs(d) < 1e-5 ? 1e7 : R / Math.abs(d);
  const screenRadius = radius * camera.z;
  const x0 = anchorX(u);
  const project = (p: Vec): Vec =>
    worldToScreen(asWorld(hub, p), camera, viewport);
  if (screenRadius < Math.max(1600, viewport.width * 1.75)) {
    const p0 = project({ x: x0, y: 0 });
    const p1 = project({ x: x0 - (2 * R) / d, y: 0 });
    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2;
    const auraRadius = Math.max(
      14,
      screenRadius + offset * (d >= 0 ? 1 : -1) * camera.z,
    );
    return { kind: "circle", cx, cy, radius: auraRadius };
  }
  const { lo, hi } = lineSampleRange(hub, camera, viewport, radius);
  if (!(lo < hi)) return { kind: "polyline", points: [] };
  const steps = Math.max(
    24,
    Math.min(120, Math.ceil(((hi - lo) * camera.z) / 12)),
  );
  const points: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = mix(lo, hi, i / steps);
    const x =
      Math.abs(d) < 1e-5
        ? x0 + offset
        : x0 +
          offset -
          (d * y * y) /
            (R * (1 + Math.sqrt(Math.max(0, 1 - (y / radius) ** 2))));
    const p = project({ x, y });
    if (Number.isFinite(p.x + p.y)) points.push(p);
  }
  return { kind: "polyline", points };
}

function portalCurve(frame: Hub, camera: Camera, viewport: Viewport): CurveClip {
  return evaluateHubCurveClip(frame, camera, viewport);
}

export function evaluatePassageGeometry(
  passage: Passage,
  camera: Camera,
  viewport: Viewport,
): PortalGeometry {
  const kind: string = passage.kind;
  if (kind === "remote" || kind === "loading") {
    const phase =
      passage.direction === "reverse" ? 1 - passage.phase : passage.phase;
    return evaluateRemotePortalGeometry(phase, viewport);
  }
  const p = clamp(passage.phase, 0, 1);
  const t = easeClamped(p);
  const a = passage.from;
  const b = passage.to;
  const angle = a.angle + (((b.angle - a.angle + 540) % 360) - 180) * t;
  const fold = passage.direction === "reverse" ? 1 - t : t;
  const frame = {
    center: {
      x: mix(a.center.x, b.center.x, t),
      y: mix(a.center.y, b.center.y, t),
    },
    angle,
    morph: 0,
    fold,
  } as Hub;
  const clip = portalCurve(frame, camera, viewport);
  return { stroke: clip.curve, boundary: clip, echo: null };
}

export function evaluateRemotePortalGeometry(
  phase: number,
  viewport: Viewport,
): PortalGeometry {
  const fold = easeClamped(clamp(phase, 0, 1));
  const frame = {
    center: { x: 0, y: 0 },
    angle: 0,
    morph: 0,
    fold,
  } as Hub;
  const clip = portalCurve(
    frame,
    { x: 0, y: 0, z: 1, rotation: 0 },
    viewport,
  );
  return {
    stroke: clip.curve,
    boundary: clip,
    echo: clip.curve,
  };
}

/** Evaluate all unfocused hub tick marks, the selected dot and beacon. */
export function evaluateTraceTicks(
  hub: Hub,
  nodes: number,
  camera: Camera,
  viewport: Viewport,
  scroll = hub.scroll,
  tickScale = 1,
  archetype?: string,
): {
  segments: Array<[Vec, Vec]>;
  dot: Vec | null;
  beacon: Vec | null;
  activeIndex: number;
} {
  const activeIndex =
    ((Math.round(scroll) % nodes) + nodes) % nodes;
  const segments: Array<[Vec, Vec]> = [];
  let dot: Vec | null = null;
  let beacon: Vec | null = null;
  for (let j = 0; j < nodes; j++) {
    const parameter = nodeS(hub, j, nodes, camera, viewport);
    const p0 = worldToScreen(
      material(hub, parameter, 0),
      camera,
      viewport,
    );
    const selected = j === activeIndex;
    const baseLength =
      (selected ? -26 : j % 2 === 0 ? -16 : -11) * tickScale;
    const p1 = worldToScreen(
      material(hub, parameter, baseLength),
      camera,
      viewport,
    );
    segments.push([p0, p1]);
    if (
      archetype === "origin" ||
      archetype === "portal" ||
      archetype === "instrument"
    ) {
      const outward = worldToScreen(
        material(hub, parameter, selected ? 9 : 4.5),
        camera,
        viewport,
      );
      segments.push([p0, outward]);
    }
    if (selected) {
      dot = worldToScreen(
        material(hub, parameter, baseLength - 5.5),
        camera,
        viewport,
      );
      beacon = worldToScreen(
        material(hub, parameter, baseLength - 22),
        camera,
        viewport,
      );
    }
  }
  return { segments, dot, beacon, activeIndex };
}

/** Sample a shallow quadratic relation filament as a finite point list. */
export function evaluateFilament(
  from: Vec,
  to: Vec,
  bend = 0.12,
  steps = 18,
): Vec[] {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const points: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
    });
  }
  return points;
}

export function curveToPrimitive(
  curve: NumericCurve,
  style: ShapeStyle = {},
): ArcPrimitive | PolylinePrimitive {
  if (curve.kind === "circle") {
    return {
      type: "arc",
      cx: curve.cx,
      cy: curve.cy,
      radius: curve.radius,
      startAngle: 0,
      endAngle: Math.PI * 2,
      ...style,
    };
  }
  return { type: "polyline", points: curve.points, ...style };
}

/** Numeric arc from `a` to `b` with a circular radius; used by star trails. */
export function arcPrimitive(
  center: Vec,
  radius: number,
  startAngle: number,
  endAngle: number,
  style: ShapeStyle = {},
): ArcPrimitive {
  return {
    type: "arc",
    cx: center.x,
    cy: center.y,
    radius,
    startAngle,
    endAngle,
    ...style,
  };
}

export function curveToSvgPath(curve: NumericCurve, close = curve.kind === "circle"): string {
  if (curve.kind === "circle") {
    const { cx, cy, radius } = curve;
    return `M${cx + radius} ${cy}A${radius} ${radius} 0 1 0 ${cx - radius} ${cy}A${radius} ${radius} 0 1 0 ${cx + radius} ${cy}Z`;
  }
  const points = curve.points;
  if (!points.length) return "";
  return (
    points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
      )
      .join("") + (close || curve.closed ? "Z" : "")
  );
}

export function clipToSvgPath(clip: CurveClip): string {
  if (clip.curve.kind === "circle") {
    if (!clip.outerRect) return curveToSvgPath(clip.curve);
    const r = clip.outerRect;
    return `M${r.x} ${r.y}H${r.x + r.width}V${r.y + r.height}H${r.x}Z ${curveToSvgPath(clip.curve)}`;
  }
  return curveToSvgPath(clip.curve, true);
}

export function clipMaskShapes(clip: CurveClip): Array<
  | { kind: "circle"; cx: number; cy: number; radius: number }
  | { kind: "polyline"; points: readonly Vec[]; closed?: boolean }
> {
  if (clip.curve.kind === "circle")
    return [
      {
        kind: "circle",
        cx: clip.curve.cx,
        cy: clip.curve.cy,
        radius: clip.curve.radius,
      },
    ];
  return [
    {
      kind: "polyline",
      points: clip.curve.points,
      closed: true,
    },
  ];
}

export function arcLengthVelocity(hub: Hub, s: number): number {
  const d = 1 - easeClamped(hub.morph);
  if (Math.abs(d) < 1e-4) return 1;
  return 1 / (1 + ((d * s) / (2 * R)) ** 2);
}

export { arcLengthAt };

/**
 * Parse SVG path data into finite polylines. The caller is responsible for
 * caching the result; GPU code never calls this per frame for static glyphs.
 */
export function parseSvgPathData(d: string, steps = 8): Vec[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  if (!tokens) return [];
  let index = 0;
  let command = "";
  let current: Vec = { x: 0, y: 0 };
  let start: Vec = { x: 0, y: 0 };
  let lastControl: Vec | null = null;
  const polylines: Vec[][] = [];
  let line: Vec[] = [];
  const number = () => Number(tokens[index++]);
  const flush = () => {
    if (line.length > 1) polylines.push(line);
    line = [];
  };
  const point = (x: number, y: number): Vec => ({ x, y });
  const cubic = (
    p0: Vec,
    c1: Vec,
    c2: Vec,
    p1: Vec,
  ): Vec[] => {
    const out: Vec[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push({
        x: u ** 3 * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * p1.x,
        y: u ** 3 * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * p1.y,
      });
    }
    return out;
  };
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) {
      command = tokens[index++];
      if (command === "Z" || command === "z") {
        if (line.length) {
          line.push({ ...start });
          flush();
        }
        current = { ...start };
        lastControl = null;
      }
      continue;
    }
    if (!command) {
      index++;
      continue;
    }
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const base = relative ? current : { x: 0, y: 0 };
    switch (upper) {
      case "M": {
        flush();
        current = point(base.x + number(), base.y + number());
        start = { ...current };
        line = [{ ...current }];
        lastControl = null;
        command = relative ? "l" : "L";
        break;
      }
      case "L": {
        current = point(base.x + number(), base.y + number());
        line.push({ ...current });
        lastControl = null;
        break;
      }
      case "H": {
        current = point(base.x + number(), current.y);
        line.push({ ...current });
        lastControl = null;
        break;
      }
      case "V": {
        current = point(current.x, base.y + number());
        line.push({ ...current });
        lastControl = null;
        break;
      }
      case "C": {
        const c1 = point(base.x + number(), base.y + number());
        const c2 = point(base.x + number(), base.y + number());
        const end = point(base.x + number(), base.y + number());
        line.push(...cubic(current, c1, c2, end));
        current = end;
        lastControl = c2;
        break;
      }
      case "S": {
        const c2 = point(base.x + number(), base.y + number());
        const end = point(base.x + number(), base.y + number());
        const c1 = lastControl
          ? { x: current.x * 2 - lastControl.x, y: current.y * 2 - lastControl.y }
          : { ...current };
        line.push(...cubic(current, c1, c2, end));
        current = end;
        lastControl = c2;
        break;
      }
      case "Q": {
        const c = point(base.x + number(), base.y + number());
        const end = point(base.x + number(), base.y + number());
        const c1 = {
          x: current.x + (2 / 3) * (c.x - current.x),
          y: current.y + (2 / 3) * (c.y - current.y),
        };
        const c2 = {
          x: end.x + (2 / 3) * (c.x - end.x),
          y: end.y + (2 / 3) * (c.y - end.y),
        };
        line.push(...cubic(current, c1, c2, end));
        current = end;
        lastControl = c;
        break;
      }
      case "T": {
        const end = point(base.x + number(), base.y + number());
        const c: Vec = lastControl
          ? { x: current.x * 2 - lastControl.x, y: current.y * 2 - lastControl.y }
          : { ...current };
        const c1 = {
          x: current.x + (2 / 3) * (c.x - current.x),
          y: current.y + (2 / 3) * (c.y - current.y),
        };
        const c2 = {
          x: end.x + (2 / 3) * (c.x - end.x),
          y: end.y + (2 / 3) * (c.y - end.y),
        };
        line.push(...cubic(current, c1, c2, end));
        current = end;
        lastControl = c;
        break;
      }
      case "A": {
        const rx = Math.abs(number());
        const ry = Math.abs(number());
        number();
        const large = number();
        const sweep = number();
        const end = point(base.x + number(), base.y + number());
        // SVG's elliptical arc is overkill for 24px icons; approximate with a
        // circular sweep in local space when possible, otherwise a chord.
        const dx = end.x - current.x;
        const dy = end.y - current.y;
        const chord = Math.hypot(dx, dy);
        const radius = Math.max(0.01, (rx + ry) / 2);
        if (chord >= radius * 2 || radius > 1e4) {
          line.push({ ...end });
        } else {
          const half = chord / 2;
          const h = Math.sqrt(Math.max(0, radius * radius - half * half));
          const ux = chord < 1e-6 ? 1 : dx / chord;
          const uy = chord < 1e-6 ? 0 : dy / chord;
          const sign = sweep ? 1 : -1;
          const cx = current.x + dx / 2 - uy * h * sign;
          const cy = current.y + dy / 2 + ux * h * sign;
          const startAngle = Math.atan2(current.y - cy, current.x - cx);
          const endAngle = Math.atan2(end.y - cy, end.x - cx);
          let delta = endAngle - startAngle;
          if (sweep && delta < 0) delta += Math.PI * 2;
          if (!sweep && delta > 0) delta -= Math.PI * 2;
          if (large && Math.abs(delta) < Math.PI) delta += sweep ? Math.PI * 2 : -Math.PI * 2;
          const arcSteps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 8)));
          for (let i = 1; i <= arcSteps; i++) {
            const a = startAngle + (delta * i) / arcSteps;
            line.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
          }
        }
        current = end;
        lastControl = null;
        break;
      }
      default:
        index++;
        break;
    }
  }
  flush();
  return polylines;
}
