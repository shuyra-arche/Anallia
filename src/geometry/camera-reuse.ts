import type { Camera, Vec, Viewport } from "../core/types.ts";
import type { ScenePrimitive, TextPrimitive } from "../core/graphics.ts";

type Shape = Exclude<ScenePrimitive, TextPrimitive>;
export interface CameraView {
  camera: Camera;
  viewport: Viewport;
}
export interface CameraMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  scale: number;
  angle: number;
}

/** Maps already projected points between cameras, without applying world projection twice. */
export function cameraMatrix(
  from: CameraView,
  to: CameraView,
): CameraMatrix | null {
  const scale = to.camera.z / from.camera.z;
  const angle = ((to.camera.rotation - from.camera.rotation) * Math.PI) / 180;
  const a = scale * Math.cos(angle),
    b = scale * Math.sin(angle),
    c = -b,
    d = a;
  const turn = (to.camera.rotation * Math.PI) / 180;
  const dx = from.camera.x - to.camera.x,
    dy = from.camera.y - to.camera.y;
  const tx =
    to.viewport.width / 2 +
    (dx * Math.cos(turn) - dy * Math.sin(turn)) * to.camera.z -
    (a * from.viewport.width) / 2 -
    (c * from.viewport.height) / 2;
  const ty =
    to.viewport.height / 2 +
    (dx * Math.sin(turn) + dy * Math.cos(turn)) * to.camera.z -
    (b * from.viewport.width) / 2 -
    (d * from.viewport.height) / 2;
  if (!(scale > 0) || ![a, b, c, d, tx, ty].every(Number.isFinite)) return null;
  return { a, b, c, d, tx, ty, scale, angle };
}

const near = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
const angleNear = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
const pointMatches = (a: Vec, b: Vec, m: CameraMatrix) =>
  near(m.a * a.x + m.c * a.y + m.tx, b.x) &&
  near(m.b * a.x + m.d * a.y + m.ty, b.y);

/** Reuse only when the submitted numeric geometry and paint agree with the transform. */
export function canReuseUnderCamera(
  before: Shape,
  after: Shape,
  m: CameraMatrix,
): boolean {
  // Refresh tessellation after a large scale change; clipping and topology must also agree.
  if (
    before.type !== after.type ||
    m.scale < 0.5 ||
    m.scale > 2 ||
    before.type === "rect" ||
    after.type === "rect"
  )
    return false;
  if (
    before.fill !== after.fill ||
    before.stroke !== after.stroke ||
    (before.opacity ?? 1) !== (after.opacity ?? 1) ||
    before.lineCap !== after.lineCap ||
    before.lineJoin !== after.lineJoin
  )
    return false;
  if (before.stroke) {
    const oldWidth = Math.max(0.25, before.strokeWidth ?? 1),
      newWidth = Math.max(0.25, after.strokeWidth ?? 1);
    if (!near(oldWidth * m.scale, newWidth)) return false;
    const oldDash = before.dash ?? [],
      newDash = after.dash ?? [];
    if (
      oldDash.length !== newDash.length ||
      oldDash.some((value, i) => !near(value * m.scale, newDash[i]))
    )
      return false;
  }
  if (before.type === "circle" && before.dash?.length && !angleNear(m.angle, 0))
    return false;
  if (before.type === "circle" && after.type === "circle")
    return (
      pointMatches(
        { x: before.cx, y: before.cy },
        { x: after.cx, y: after.cy },
        m,
      ) && near(before.radius * m.scale, after.radius)
    );
  if (before.type === "arc" && after.type === "arc") {
    const wholeCircle = near(Math.abs(before.endAngle - before.startAngle), 2 * Math.PI) && !before.dash?.length;
    return (
      pointMatches(
        { x: before.cx, y: before.cy },
        { x: after.cx, y: after.cy },
        m,
      ) &&
      near(before.radius * m.scale, after.radius) &&
      (wholeCircle || (angleNear(before.startAngle + m.angle, after.startAngle) &&
        angleNear(before.endAngle + m.angle, after.endAngle))) &&
      (before.anticlockwise ?? false) === (after.anticlockwise ?? false) &&
      near(
        before.endAngle - before.startAngle,
        after.endAngle - after.startAngle,
      )
    );
  }
  if (before.type === "polyline" && after.type === "polyline")
    return (
      (before.closed ?? false) === (after.closed ?? false) &&
      before.points.length === after.points.length &&
      before.points.every((point, i) => pointMatches(point, after.points[i], m))
    );
  return false;
}
