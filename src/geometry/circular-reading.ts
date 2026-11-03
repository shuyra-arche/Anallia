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

export const CIRCULAR_LYRICS_LINE_ANGLE = (5.0 * Math.PI) / 180; // 5.0 deg (~0.087266 rad)
export const CIRCULAR_LYRICS_SLOTS = 72; // 360 / 5 = 72

/**
 * Natural, compact radial line spacing (~5.0° / 24px arc gap at inner edge).
 * Text lines follow one after another in a coherent fan, not overly spread out.
 * Overlap occurs when total lines span more than a full circle (N > 72).
 */
export function circularLyricsLayout(lineCount: number): {
  slots: number;
  lineAngle: number;
  hasOverlap: boolean;
} {
  const N = Math.max(1, lineCount);
  const slots = CIRCULAR_LYRICS_SLOTS;
  const lineAngle = CIRCULAR_LYRICS_LINE_ANGLE;
  const hasOverlap = N > slots;
  return {
    slots,
    lineAngle,
    hasOverlap,
  };
}

/**
 * Compute the world position and radial baseline angle for a row at reading progress.
 * The active row (row === progress) sits exactly at the anchor (badge) angle thetaAnchor.
 * Text floats/rotates along the circle as progress advances, keeping the camera stationary.
 */
export function circularLyricsPose(
  hub: Hub,
  startS: number,
  row: number,
  progress: number,
  radius: number,
  lineAngle: number,
): { point: Vec; baselineAngle: number; rawAngleRad: number } {
  if (
    ![
      hub.center.x,
      hub.center.y,
      hub.angle,
      startS,
      row,
      progress,
      radius,
      lineAngle,
    ].every(Number.isFinite) ||
    radius <= 0 ||
    lineAngle <= 0
  )
    throw new RangeError(
      "Circular lyrics pose requires finite geometry and positive dimensions",
    );

  const anchorAngle =
    (hub.angle * Math.PI) / 180 + 2 * Math.atan(startS / (2 * R));
  // Row angle relative to anchor: when row === progress, angle === anchorAngle.
  // When scrolling down (progress increases), previous rows rotate backwards (negative offset),
  // and next rows rotate into the anchor angle.
  const angle = anchorAngle + (row - progress) * lineAngle;

  return {
    point: {
      x: hub.center.x + radius * Math.cos(angle),
      y: hub.center.y + radius * Math.sin(angle),
    },
    baselineAngle: (angle * 180) / Math.PI,
    rawAngleRad: angle,
  };
}

/**
 * Music player lyrics display effect for opacity:
 * - Active lyric (d < 0.5): 1.0 (crisp, prominent)
 * - Near context (0.5 <= d < 2.0): 0.88 - 1.0
 * - Ambient visible context: 0.72
 * - Overlap fade: Dissolves to 0 ONLY when earlier and later text would overlap
 *   at the back of the circle (degDiff >= 135° to 175°).
 *   For short/medium articles (e.g. 7 or 22 lines), degDiff never reaches 135°,
 *   so NO text is prematurely dissolved!
 */
export function circularLyricsOpacity(
  row: number,
  progress: number,
  lineCount: number,
  slots = CIRCULAR_LYRICS_SLOTS,
  lineAngle = CIRCULAR_LYRICS_LINE_ANGLE,
): number {
  const d = Math.abs(row - progress);
  if (d < 0.5) return 1.0;
  if (d < 2.0) return 1.0 - 0.12 * (d - 0.5);

  if (lineCount <= slots) return 0.72;
  const degDiff = (d * lineAngle * 180) / Math.PI;
  // Overlap threshold: opposite side of circle (135° to 175°)
  if (degDiff < 135) {
    return 0.72;
  }
  if (degDiff >= 175) {
    return 0.0;
  }
  // Smoothly fade to 0 between 135° and 175°
  const t = (degDiff - 135) / (175 - 135);
  const ease = (1 - t) * (1 - t);
  return 0.72 * ease;
}
