import type { Camera, Hub, Vec } from "../core/types.ts";
import { R, orbitCamera } from "./field.ts";

export const READING_LINE_STEP = 30;
const readingInnerRadius = R + 76;
const readingLineGap = 22;
export const READING_RING_CAPACITY = Math.floor(
  (2 * Math.PI * readingInnerRadius) / readingLineGap,
);
export const READING_LINE_ANGLE = (2 * Math.PI) / READING_RING_CAPACITY;

export function circularReadingSlots(lineCount: number): number {
  if (!Number.isSafeInteger(lineCount) || lineCount < 1)
    throw new RangeError("Reading requires a positive line count");
  return READING_RING_CAPACITY;
}

/** Absolute source indices advance while each ring retains readable angular spacing. */
export function circularReadingPose(
  hub: Hub,
  startS: number,
  row: number,
  radius: number,
  lineAngle = READING_LINE_ANGLE,
): { point: Vec; baselineAngle: number } {
  if (
    ![
      hub.center.x,
      hub.center.y,
      hub.angle,
      startS,
      row,
      radius,
      lineAngle,
    ].every(Number.isFinite) ||
    row < 0 ||
    radius <= 0 ||
    lineAngle <= 0
  )
    throw new RangeError(
      "Circular reading requires finite geometry and positive dimensions",
    );
  const angle =
    (hub.angle * Math.PI) / 180 +
    2 * Math.atan(startS / (2 * R)) +
    row * lineAngle;
  return {
    point: {
      x: hub.center.x + radius * Math.cos(angle),
      y: hub.center.y + radius * Math.sin(angle),
    },
    baselineAngle: (angle * 180) / Math.PI,
  };
}

export function circularReadingOpacity(
  row: number,
  progress: number,
  slots = READING_RING_CAPACITY,
): number {
  const distance = row - progress;
  if (distance < 0) return Math.max(0, 1 + distance);
  const prominence = 1 - 0.65 * Math.min(1, distance / Math.max(1, slots - 1));
  return prominence * Math.max(0, Math.min(1, slots - distance));
}

/** Orbit the hub so the next row occupies the gaze ray of the current row. */
export function circularReadingCamera(
  hub: Hub,
  fromBearing: number,
  toBearing: number,
  camera: Camera,
): Camera {
  return orbitCamera(
    camera,
    hub.center,
    camera.rotation + fromBearing - toBearing,
  );
}
