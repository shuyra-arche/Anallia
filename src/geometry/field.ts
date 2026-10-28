import type { Camera, Hub, Passage, Vec, Viewport } from "../core/types.ts";
import { placeReading, readingHeight, readingWidth } from "../core/layout.ts";
import {
  V,
  add,
  sub,
  mul,
  rot,
  unit,
  cDiv,
  len,
  ease,
  clamp,
  mix,
} from "../core/math.ts";
export const R = 195;
export const asWorld = (hub: Hub, p: Vec): Vec =>
  add(hub.center, rot(p, (hub.angle * Math.PI) / 180));
export function worldToScreen(p: Vec, camera: Camera, viewport: Viewport): Vec {
  const q = rot(sub(p, camera), (camera.rotation * Math.PI) / 180);
  return V(
    viewport.width / 2 + q.x * camera.z,
    viewport.height / 2 + q.y * camera.z,
  );
}
export function hubToScreen(
  _hub: Hub,
  p: Vec,
  camera: Camera,
  viewport: Viewport,
): Vec {
  return worldToScreen(p, camera, viewport);
}
/** Solve the camera translation exactly: a world material point remains pinned to
 * the same screen pixel while rotation and geometry change independently. */
export function cameraPinnedToPoint(
  worldPoint: Vec,
  screenPoint: Vec,
  camera: Camera,
  viewport: Viewport,
  rotation: number,
): Camera {
  const relative = V(
    (screenPoint.x - viewport.width / 2) / camera.z,
    (screenPoint.y - viewport.height / 2) / camera.z,
  );
  const offset = rot(relative, (-rotation * Math.PI) / 180);
  return {
    x: worldPoint.x - offset.x,
    y: worldPoint.y - offset.y,
    z: camera.z,
    rotation,
  };
}
/** Pin one semantic material point on a Hub in screen coordinates (`hubToScreen`)
 * while the camera rotates and the hub morphs; preserves exact `camera.z`. */
export function cameraPinnedToHubPoint(
  _hub: Hub,
  point: Vec,
  target: Vec,
  camera: Camera,
  viewport: Viewport,
  rotation: number,
): Camera {
  return cameraPinnedToPoint(point, target, camera, viewport, rotation);
}
export function screenToWorld(p: Vec, camera: Camera, viewport: Viewport): Vec {
  return add(
    camera,
    rot(
      V(
        (p.x - viewport.width / 2) / camera.z,
        (p.y - viewport.height / 2) / camera.z,
      ),
      (-camera.rotation * Math.PI) / 180,
    ),
  );
}
export const shapeU = (hub: Hub): number =>
  hub.morph + (2 - hub.morph) * hub.fold;
const anchorX = (u: number): number => R * (1 - 2 * ease(clamp(u - 1, 0, 1)));
export function transformLocal(hub: Hub, p: Vec, u = shapeU(hub)): Vec {
  const z = sub(p, V(R, 0)),
    d = add(V(1, 0), mul(z, u / (2 * R)));
  if (len(d) < 1e-5) return asWorld(hub, V(anchorX(u), p.y));
  return asWorld(hub, add(cDiv(z, d), V(anchorX(u), 0)));
}
function curvePoint(hub: Hub, s: number, u = shapeU(hub)): Vec {
  const theta = 2 * Math.atan(s / (2 * R));
  return transformLocal(hub, V(R * Math.cos(theta), R * Math.sin(theta)), u);
}
/**
 * Exact unit outward normal in the Darboux frame of the generalized circle.
 * In line mode (u = 1), this is constant along the entire line so labels and
 * text blocks never drift or skew as `s` increases.
 */
export function outwardNormal(hub: Hub, s: number, u = shapeU(hub)): Vec {
  const d = 1 - u;
  const rad = (hub.angle * Math.PI) / 180;
  if (Math.abs(d) < 1e-4) {
    return V(Math.cos(rad), Math.sin(rad));
  }
  const theta = 2 * Math.atan(s / (2 * R));
  const z = sub(V(R * Math.cos(theta), R * Math.sin(theta)), V(R, 0));
  const denom = add(V(1, 0), mul(z, u / (2 * R)));
  if (len(denom) < 1e-5) {
    return V(Math.cos(rad), Math.sin(rad));
  }
  const sq = V(denom.x * denom.x - denom.y * denom.y, 2 * denom.x * denom.y);
  const invSq = cDiv(V(1, 0), sq);
  const localNormal = unit(
    V(
      Math.cos(theta) * invSq.x - Math.sin(theta) * invSq.y,
      Math.sin(theta) * invSq.x + Math.cos(theta) * invSq.y,
    ),
  );
  return rot(localNormal, rad);
}
/**
 * Evaluate a point on the Hub curve (`offset = 0`) or displaced by Euclidean distance
 * `offset` along the exact Darboux outward normal (`offset != 0`).
 */
export function material(
  hub: Hub,
  s: number,
  offset = 0,
  u = shapeU(hub),
): Vec {
  const base = curvePoint(hub, s, u);
  if (offset === 0) return base;
  return add(base, mul(outwardNormal(hub, s, u), offset));
}
/**
 * Advance along the Hub curve from `baseS` by exact Euclidean arc length `deltaArc`
 * so labels and navigation items maintain constant spacing regardless of scroll angle.
 */
export function arcOffsetS(
  hub: Hub,
  baseS: number,
  deltaArc: number,
  u = shapeU(hub),
): number {
  const d = 1 - u;
  if (Math.abs(d) < 1e-4) return baseS + deltaArc;
  const k = d / (2 * R);
  const alpha = Math.atan(k * baseS) + k * deltaArc;
  const cos = Math.cos(alpha);
  if (Math.abs(cos) < 1e-4)
    return ((Math.sign(Math.sin(alpha)) || 1) * 1e6) / Math.sign(k || 1);
  return Math.sin(alpha) / (k * cos);
}
export function pitch(hub: Hub, _camera: Camera, viewport: Viewport): number {
  const line =
    viewport.width < 700
      ? Math.max(
          280,
          (Math.min(280, viewport.width * 0.64) + 48) /
            clamp(viewport.width / 620, 0.5, 0.74),
        )
      : 340;
  return mix(165, line, ease(clamp(hub.morph, 0, 1)));
}
export const nodeS = (
  hub: Hub,
  index: number,
  count: number,
  camera: Camera,
  viewport: Viewport,
): number => {
  const m = ease(clamp(hub.morph, 0, 1));
  const linePitch = pitch(hub, camera, viewport);
  const circleRef = hub.layout === "anchored" ? 0 : (count - 1) / 2;
  const ref = mix(circleRef, hub.scroll, m);
  const baseArc = hub.layout === "anchored" ? 68 : count > 6 ? 118 : 165;
  const arcStep = mix(baseArc, linePitch, m);
  return arcOffsetS(
    hub,
    0,
    (index - ref) * arcStep + (1 - m) * (hub.anchorOffset ?? 0),
    m,
  );
};
/** Arc-length position from the canonical material origin, inverse of arcOffsetS(0, arc). */
export function arcLengthAt(hub: Hub, s: number): number {
  const d = 1 - ease(clamp(hub.morph, 0, 1));
  if (Math.abs(d) < 1e-4) return s;
  return ((2 * R) / d) * Math.atan((d * s) / (2 * R));
}
/** Keep canonical hub coordinates clean (zero permanent offset drift). */
export function keepContentAnchor(
  hub: Hub,
  sourceIndex: number,
  sourceCount: number,
  targetIndex: number,
  targetCount: number,
  camera: Camera,
  viewport: Viewport,
): void {
  const previous = arcLengthAt(
    hub,
    nodeS(hub, sourceIndex, sourceCount, camera, viewport),
  );
  const circleRef = hub.layout === "anchored" ? 0 : (targetCount - 1) / 2;
  const baseArc = hub.layout === "anchored" ? 68 : targetCount > 6 ? 118 : 165;
  hub.anchorOffset = previous - (targetIndex - circleRef) * baseArc;
}
export function evaluateHubGeometry(
  hub: Hub,
  camera: Camera,
  viewport: Viewport,
  u = shapeU(hub),
): { strokeD: string; sweptClipD: string } {
  const cam = camera;
  const d = 1 - u,
    rad = Math.abs(d) < 1e-5 ? 1e7 : R / Math.abs(d),
    screenRad = rad * cam.z,
    x0 = anchorX(u);
  const { width: w, height: h } = viewport;
  const project = (p: Vec): Vec =>
    worldToScreen(asWorld(hub, p), cam, viewport);
  if (screenRad < Math.max(1600, w * 1.75)) {
    const p0 = project(V(x0, 0)),
      p1 = project(V(x0 - (2 * R) / d, 0));
    const circle = `M${p0.x} ${p0.y}A${screenRad} ${screenRad} 0 1 0 ${p1.x} ${p1.y}A${screenRad} ${screenRad} 0 1 0 ${p0.x} ${p0.y}Z`;
    return {
      strokeD: circle,
      sweptClipD:
        d > 0 ? circle : `M-200 -200H${w + 200}V${h + 200}H-200Z ${circle}`,
    };
  }
  const corners = [
    V(-260, -260),
    V(w + 260, -260),
    V(w + 260, h + 260),
    V(-260, h + 260),
  ].map((p) =>
    rot(
      sub(screenToWorld(p, cam, viewport), hub.center),
      (-hub.angle * Math.PI) / 180,
    ),
  );
  const lo = Math.max(-rad, Math.min(...corners.map((p) => p.y)) - 400),
    hi = Math.min(rad, Math.max(...corners.map((p) => p.y)) + 400);
  if (!(lo < hi)) return { strokeD: "", sweptClipD: "" };
  const steps = Math.max(28, Math.min(180, Math.ceil(((hi - lo) * cam.z) / 8)));
  let path = "";
  for (let i = 0; i <= steps; i++) {
    const y = mix(lo, hi, i / steps),
      x =
        Math.abs(d) < 1e-5
          ? x0
          : x0 -
            (d * y * y) /
              (R * (1 + Math.sqrt(Math.max(0, 1 - (y / rad) ** 2))));
    const p = project(V(x, y));
    if (Number.isFinite(p.x + p.y))
      path += `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  const a = project(V(x0 - 5000, hi)),
    b = project(V(x0 - 5000, lo));
  return { strokeD: path, sweptClipD: `${path}L${a.x} ${a.y}L${b.x} ${b.y}Z` };
}
/** A limited change in the reading bearing lets the circle move around the
 * pinned label, without sweeping the full circle through the reading window. */
export function readingBearing(hub: Hub, scroll = hub.scroll): number {
  const step = hub.layout === "anchored" ? 68 : 118;
  const drift =
    32 * Math.tanh((((scroll - (hub.readingStart ?? 0)) * step) / R) * 0.6);
  return (hub.readingBearing ?? hub.angle) + drift * (1 - ease(hub.morph));
}

export function readingRotation(
  hub: Hub,
  scroll: number,
  count: number,
  camera: Camera,
  viewport: Viewport,
): number {
  const s = nodeS(hub, scroll, count, camera, viewport);
  const normal = outwardNormal(hub, s);
  return (
    readingBearing(hub, scroll) -
    (Math.atan2(normal.y, normal.x) * 180) / Math.PI
  );
}

export function frameFor(
  hub: Hub,
  scroll: number,
  count: number,
  camera: Camera,
  viewport: Viewport,
): Camera {
  const { width: w, height: h } = viewport;
  const margin = w < 700 ? 16 : 24;
  const width = readingWidth(viewport, true);
  const z = Math.min(1.12, Math.max(1, w - 2 * margin) / width);
  const settled = { ...hub, scroll, morph: hub.targetMorph };
  const s = nodeS(settled, scroll, count, camera, viewport);
  const p = material(settled, s, 76);
  const rotation = readingRotation(settled, scroll, count, camera, viewport);
  const normal = rot(outwardNormal(settled, s), (rotation * Math.PI) / 180);
  const height = Math.min(360, readingHeight(viewport, z));
  const placement = placeReading(V(0, 0), normal, width, height, z);
  const left = clamp(
    (w - width * z) / 2 + normal.x * 65,
    margin,
    w - margin - width * z,
  );
  const top = Math.max(76, (h - height * z) / 2);
  return cameraPinnedToPoint(
    p,
    V(left - placement.left, top - placement.top),
    { ...camera, z },
    viewport,
    rotation,
  );
}
export const overviewCamera = (v: Viewport): Camera => ({
  x: 180,
  y: 40,
  z: clamp(Math.min(v.width / 3600, v.height / 1950), 0.28, 0.52),
  rotation: 0,
});

/** Rotate the camera around a world pivot while preserving its exact screen projection. */
export function orbitCamera(
  camera: Camera,
  pivot: Vec,
  rotation: number,
): Camera {
  const delta = ((rotation - camera.rotation) * Math.PI) / 180;
  return {
    ...add(pivot, rot(sub(camera, pivot), -delta)),
    z: camera.z,
    rotation,
  };
}

/**
 * True Möbius portal boundary throughout a traversal:
 * `fold` sweeps monotonically across [0, 1] (so `u = 2 * fold` sweeps 0 [circle] → 1 [line at p=0.5] → 2 [dual inverted circle]),
 * rather than reversing at p = 0.5.
 */
export function passageGeometry(
  passage: Passage,
  camera: Camera,
  viewport: Viewport,
): { strokeD: string; sweptClipD: string } {
  if (passage.kind === "remote" || passage.kind === "loading") {
    const phase =
      passage.direction === "reverse" ? 1 - passage.phase : passage.phase;
    return remotePortalGeometry(phase, camera, viewport);
  }
  const p = clamp(passage.phase, 0, 1);
  const t = ease(p);
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
  return evaluateHubGeometry(frame, camera, viewport);
}

/**
 * Screen-space Möbius portal evaluation:
 * As phase p ∈ [0, 1] advances, `fold = ease(p)` drives `u = 2 * fold` monotonically
 * from 0 (circle interior) through 1 (infinite straight line at p = 0.5) to 2 (inverted circle exterior).
 */
export function remotePortalGeometry(
  phase: number,
  _camera: Camera,
  viewport: Viewport,
): { strokeD: string; sweptClipD: string } {
  const p = clamp(phase, 0, 1);
  const fold = ease(p);
  const frame = {
    center: V(0, 0),
    angle: 0,
    morph: 0,
    fold,
  } as Hub;
  return evaluateHubGeometry(
    frame,
    { x: 0, y: 0, z: 1, rotation: 0 },
    viewport,
  );
}
