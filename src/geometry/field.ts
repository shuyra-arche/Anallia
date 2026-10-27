import type { Camera, Hub, Vec, Viewport } from "../core/types.ts";
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
export function material(
  hub: Hub,
  s: number,
  offset = 0,
  u = shapeU(hub),
): Vec {
  const theta = 2 * Math.atan(s / (2 * R)),
    rad = R + offset;
  return transformLocal(
    hub,
    V(rad * Math.cos(theta), rad * Math.sin(theta)),
    u,
  );
}
export const outwardNormal = (hub: Hub, s: number, u = shapeU(hub)): Vec =>
  unit(sub(material(hub, s, 1.5, u), material(hub, s, 0, u)));
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
          340,
          (Math.min(310, viewport.width * 0.78) + 54) /
            clamp(viewport.width / 740, 0.42, 0.6),
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
  if (hub.layout === "anchored") {
    const arcStep = mix(68, linePitch, m);
    return arcOffsetS(hub, 0, index * arcStep, m);
  }
  if (count > 6) {
    const arcStep = mix(118, linePitch, m);
    return arcOffsetS(hub, 0, (index - (count - 1) / 2) * arcStep, m);
  }
  const arcStep = mix(165, linePitch, m);
  return arcOffsetS(hub, 0, (index - (count - 1) / 2) * arcStep, m);
};
export function evaluateHubGeometry(
  hub: Hub,
  camera: Camera,
  viewport: Viewport,
  u = shapeU(hub),
): { strokeD: string; sweptClipD: string } {
  const d = 1 - u,
    rad = Math.abs(d) < 1e-5 ? 1e7 : R / Math.abs(d),
    screenRad = rad * camera.z,
    x0 = anchorX(u);
  const { width: w, height: h } = viewport;
  const project = (p: Vec): Vec =>
    worldToScreen(asWorld(hub, p), camera, viewport);
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
      sub(screenToWorld(p, camera, viewport), hub.center),
      (-hub.angle * Math.PI) / 180,
    ),
  );
  const lo = Math.max(-rad, Math.min(...corners.map((p) => p.y)) - 400),
    hi = Math.min(rad, Math.max(...corners.map((p) => p.y)) + 400);
  if (!(lo < hi)) return { strokeD: "", sweptClipD: "" };
  const steps = Math.max(
    28,
    Math.min(180, Math.ceil(((hi - lo) * camera.z) / 8)),
  );
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
export function frameFor(
  hub: Hub,
  scroll: number,
  count: number,
  camera: Camera,
  viewport: Viewport,
): Camera {
  const { width: w, height: h } = viewport,
    small = w < 700;
  const base = small
    ? clamp(w / 740, 0.42, 0.6)
    : clamp(Math.min(w / 1220, h / 820), 0.72, 1.02);
  const effectiveCount = hub.layout === "anchored" ? 3 : count;
  const z = small
    ? base
    : base * (effectiveCount >= 3 ? 0.78 : effectiveCount === 2 ? 0.88 : 1);
  const s = nodeS(hub, scroll, count, camera, viewport),
    u = ease(clamp(hub.targetMorph, 0, 1));
  const p = material(hub, s, 0, u),
    n = outwardNormal(hub, s, u),
    angle = (Math.atan2(n.y, n.x) * 180) / Math.PI;
  return {
    ...add(p, mul(n, small ? 155 : 205)),
    z,
    rotation: (small ? 90 : 0) - angle,
  };
}
export const overviewCamera = (v: Viewport): Camera => ({
  x: 25,
  y: 65,
  z: clamp(Math.min(v.width / 1950, v.height / 1320), 0.24, 0.54),
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
