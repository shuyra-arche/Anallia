import type { Camera, Hub, Viewport } from "../core/types.ts";
import { evaluateHubCurve } from "./graphics.ts";
import { material, R } from "./field.ts";

export interface OverviewRegion { left: number; top: number; width: number; height: number }

/** Fit complete finite circles and the anchor neighbourhood of infinite lines.
 * Lines deliberately continue beyond the frame; their full extent has no bounds.
 */
export function overviewFootprints(hubs: readonly Hub[]): OverviewRegion[] {
  return hubs.map(hub => {
    const curve = evaluateHubCurve(hub, { x: 0, y: 0, z: 1, rotation: 0 }, { width: 0, height: 0 });
    if (curve.kind === "circle") return {
      left: curve.cx - curve.radius - 32, top: curve.cy - curve.radius - 32,
      width: 2 * (curve.radius + 32), height: 2 * (curve.radius + 32),
    };
    const points = [-R, 0, R].map(s => material(hub, s));
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return { left: Math.min(...xs) - 32, top: Math.min(...ys) - 32,
      width: Math.max(...xs) - Math.min(...xs) + 64,
      height: Math.max(...ys) - Math.min(...ys) + 64 };
  });
}

export function fitOverviewCamera(viewport: Viewport, hubs: readonly Hub[], region: OverviewRegion): Camera {
  const footprints = overviewFootprints(hubs);
  if (!footprints.length) return { x: 0, y: 0, z: 1, rotation: 0 };
  const left = Math.min(...footprints.map(b => b.left));
  const top = Math.min(...footprints.map(b => b.top));
  const right = Math.max(...footprints.map(b => b.left + b.width));
  const bottom = Math.max(...footprints.map(b => b.top + b.height));
  const z = Math.min(0.52, Math.max(1, region.width) / Math.max(1, right - left), Math.max(1, region.height) / Math.max(1, bottom - top));
  return {
    x: (left + right) / 2 - (region.left + region.width / 2 - viewport.width / 2) / z,
    y: (top + bottom) / 2 - (region.top + region.height / 2 - viewport.height / 2) / z,
    z, rotation: 0,
  };
}
