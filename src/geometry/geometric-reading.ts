import type { Camera, Hub, Vec, Viewport } from "../core/types.ts";
import { rot } from "../core/math.ts";
import { arcOffsetS, material, outwardNormal, shapeU, worldToScreen } from "./field.ts";

export interface GeometricReadingRequest {
  hub: Hub;
  camera: Camera;
  viewport: Viewport;
  /** Material coordinate of the first row; callers may obtain it with nodeS. */
  startS: number;
  lineCount: number;
  /** Spacing along the curve, outward offset and width cap in screen pixels. */
  lineSpacing: number;
  offset: number;
  maxWidth: number;
}

export interface GeometricReadingLine {
  /** Screen-space center of the text baseline. */
  anchor: Vec;
  /** Screen-space degrees, normalized to [-90, 90); line geometry is always 0. */
  baselineAngle: number;
  /** Centered baseline length inside the viewport, capped by maxWidth. */
  availableWidth: number;
}

function centeredWidth(anchor: Vec, angle: number, viewport: Viewport, maxWidth: number): number {
  if (anchor.x < 0 || anchor.x > viewport.width || anchor.y < 0 || anchor.y > viewport.height) return 0;
  const radians = angle * Math.PI / 180;
  const dx = Math.abs(Math.cos(radians));
  const dy = Math.abs(Math.sin(radians));
  const halfWidth = Math.min(
    maxWidth / 2,
    dx > 1e-12 ? Math.min(anchor.x, viewport.width - anchor.x) / dx : Infinity,
    dy > 1e-12 ? Math.min(anchor.y, viewport.height - anchor.y) / dy : Infinity,
  );
  return Math.max(0, halfWidth * 2);
}

/** Static row constraints only: no text measurement, DOM, clipping or animation. */
export function geometricReadingLines(request: GeometricReadingRequest): GeometricReadingLine[] {
  const { hub, camera, viewport, startS, lineCount, lineSpacing, offset, maxWidth } = request;
  const values = [hub.center.x, hub.center.y, hub.angle, hub.morph, hub.fold,
    camera.x, camera.y, camera.z, camera.rotation, viewport.width, viewport.height,
    startS, lineSpacing, offset, maxWidth];
  if (!values.every(Number.isFinite) || !Number.isSafeInteger(lineCount) || lineCount < 0 ||
      camera.z <= 0 || viewport.width <= 0 || viewport.height <= 0 ||
      lineSpacing <= 0 || offset < 0 || maxWidth <= 0) {
    throw new RangeError("Geometric reading requires finite geometry, a non-negative row count and positive layout dimensions");
  }
  const u = shapeU(hub);
  const isLine = Math.abs(1 - u) < 1e-4;
  return Array.from({ length: lineCount }, (_, index) => {
    const s = arcOffsetS(hub, startS, index * lineSpacing / camera.z, u);
    const anchor = worldToScreen(material(hub, s, offset / camera.z, u), camera, viewport);
    const normal = rot(outwardNormal(hub, s, u), camera.rotation * Math.PI / 180);
    const angle = Math.atan2(normal.y, normal.x) * 180 / Math.PI;
    const baselineAngle = isLine ? 0 : ((angle + 90) % 180 + 180) % 180 - 90;
    if (![s, anchor.x, anchor.y, baselineAngle].every(Number.isFinite)) {
      throw new RangeError("Geometric reading produced a non-finite row");
    }
    return { anchor, baselineAngle, availableWidth: centeredWidth(anchor, baselineAngle, viewport, maxWidth) };
  });
}
