import type { Camera, Hub, Vec, Viewport } from "../core/types.ts";
import { clamp, ease, rot } from "../core/math.ts";
import { R, arcOffsetS, material, outwardNormal, shapeU, worldToScreen } from "./field.ts";

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

export interface SpineContourPose extends GeometricReadingLine {
  /** Screen-space x coordinate of the hub-facing contour edge at this row's y. */
  edgeX: number;
  /** Screen-space x coordinate of the hub spine at this row's y. */
  spineX: number;
  /** Which side of the hub spine the text sits on: 1 = right of spine, -1 = left of spine. */
  side: 1 | -1;
  /** Hub-facing edge of the row box ("left" when side === 1, "right" when side === -1). */
  hubEdge: "left" | "right";
  /** Extra horizontal indent (px in unscaled row space) induced by badges/labels at this row. */
  badgeIndent: number;
  /** Whether this row sits at the focal anchor badge slot. */
  isAnchorRow?: boolean;
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

/**
 * Compute horizontal text row poses that closely envelope a Circle Hub (u < 0.5)
 * or a Line / Curved Spine Hub (u >= 0.5) at a single reading anchor point (`startS`).
 * When scrolling (`subLineOffset`), rows float smoothly past the anchor while their
 * hub-facing edges glide along the circular arc or tilted spine contour.
 */
export function spineContourPoses(request: {
  hub: Hub;
  camera: Camera;
  viewport: Viewport;
  startS: number;
  lineCount: number;
  lineHeight: number;
  maxWidth: number;
  capacity?: number;
  bottomInset?: number;
  rightInset?: number;
  subLineOffset?: number;
}): SpineContourPose[] {
  const {
    hub,
    camera,
    viewport,
    startS,
    lineCount,
    lineHeight,
    maxWidth,
    capacity,
    bottomInset = 0,
    rightInset = 0,
    subLineOffset = 0,
  } = request;
  if (lineCount <= 0 || camera.z <= 0 || viewport.width <= 0 || viewport.height <= 0) return [];

  const z = camera.z;
  const u = shapeU(hub);
  const isCircle = u < 0.5;
  const center = worldToScreen(hub.center, camera, viewport);
  const hinge = worldToScreen(material(hub, startS, 0, u), camera, viewport);
  const tagCenter = worldToScreen(material(hub, startS, 48, u), camera, viewport);
  const normal = rot(outwardNormal(hub, startS, u), (camera.rotation * Math.PI) / 180);
  const side: 1 | -1 =
    Math.abs(normal.x) >= 0.14
      ? normal.x >= 0
        ? 1
        : -1
      : isCircle
        ? hinge.x >= center.x
          ? 1
          : -1
        : hinge.x <= (viewport.width - rightInset) * 0.52
          ? 1
          : -1;
  const hubEdge: "left" | "right" = side === 1 ? "left" : "right";

  const marginX = Math.max(16, 18 * z);
  const maxRightX = viewport.width - rightInset - marginX;
  const minLeftX = marginX;
  const topMargin = Math.max(28, 26 * z);
  const effectiveBottom = Math.max(
    topMargin + lineHeight * z * 2,
    viewport.height - bottomInset - 18 * z,
  );
  // Use stable capacity (not fluctuating visible.length) so startY never jumps when subLineOffset crosses 0.5
  const spanCount = capacity ?? lineCount;

  if (isCircle) {
    // Circle contour envelope anchored at startS:
    // Place the block so it straddles the focal badge (with ~30% of rows above the badge and ~70% below)
    const anchorSlot =
      spanCount <= 3 ? 0 : Math.min(3, Math.floor((spanCount - 1) * 0.3));
    const idealStartY = tagCenter.y - anchorSlot * lineHeight * z;
    const maxStartY = Math.max(
      topMargin,
      effectiveBottom - Math.max(0, spanCount - 1) * lineHeight * z,
    );
    const startY = clamp(idealStartY, topMargin, maxStartY);

    const contourR = (R + 26) * z;
    const obstacles: { x: number; y: number; r: number; pad: number }[] = [
      // Focused chapter badge at (R + 48) with 16px ring
      { x: tagCenter.x, y: tagCenter.y, r: 29 * z, pad: 10 * z },
    ];
    for (const localArc of [45, 90]) {
      const localS = arcOffsetS(hub, startS, localArc, u);
      const pt = worldToScreen(material(hub, localS, 22, u), camera, viewport);
      obstacles.push({ x: pt.x, y: pt.y, r: 21 * z, pad: 8 * z });
    }
    for (const peerArc of [-165, 165]) {
      const peerS = arcOffsetS(hub, startS, peerArc, u);
      const pt = worldToScreen(material(hub, peerS, 48, u), camera, viewport);
      obstacles.push({ x: pt.x, y: pt.y, r: 22 * z, pad: 8 * z });
    }

    return Array.from({ length: lineCount }, (_, index) => {
      const y = startY + index * lineHeight * z - subLineOffset * z;
      const dyCircle = y - center.y;
      const absDy = Math.abs(dyCircle);
      const knee = contourR * 0.94;
      let chordCircle: number;
      if (absDy <= knee) {
        chordCircle = Math.sqrt(Math.max(0, contourR * contourR - absDy * absDy));
      } else {
        const kneeChord = Math.sqrt(Math.max(0, contourR * contourR - knee * knee));
        const excess = (absDy - knee) / (56 * z);
        chordCircle = kneeChord * Math.exp(-(excess * excess));
      }

      const rawSpineX = center.x + side * Math.sqrt(Math.max(0, (R * z) ** 2 - Math.min(absDy, R * z * 0.96) ** 2));
      const spineX = clamp(
        rawSpineX,
        side === 1 ? minLeftX : minLeftX + 140 * z,
        side === 1 ? maxRightX - 140 * z : maxRightX,
      );

      let edgeX = center.x + side * chordCircle;
      for (const obs of obstacles) {
        if (side * (obs.x - center.x) < -20 * z) continue;
        const dy = Math.abs(y - obs.y);
        if (dy < obs.r) {
          const chord = Math.sqrt(Math.max(0, obs.r * obs.r - dy * dy));
          const candidateX = obs.x + side * (chord + obs.pad);
          if (side * (candidateX - edgeX) > 0) {
            edgeX = candidateX;
          }
        }
      }

      edgeX = clamp(
        edgeX,
        side === 1 ? minLeftX : minLeftX + 140 * z,
        side === 1 ? maxRightX - 140 * z : maxRightX,
      );
      const badgeIndent = Math.max(0, (side * (edgeX - spineX) - 26 * z) / z);
      const rawAvailable = side === 1 ? maxRightX - edgeX : edgeX - minLeftX;
      const availableWidth = clamp(rawAvailable, 0, maxWidth);
      const rowSpan = Math.min(maxWidth, Math.max(120 * z, availableWidth));
      const anchorX = edgeX + side * (rowSpan * 0.5);
      const isAnchorRow = Math.abs(y - tagCenter.y) < lineHeight * z * 0.55;

      return {
        anchor: { x: anchorX, y },
        baselineAngle: 0,
        availableWidth: Math.max(availableWidth, Math.min(maxWidth, 160 * z)),
        edgeX,
        spineX,
        side,
        hubEdge,
        badgeIndent,
        isAnchorRow,
      };
    });
  }

  // Tangent vector along the spine in screen space: t = (-ny, nx)
  const tx = -normal.y;
  const ty = normal.x;
  const signTy = ty >= 0 ? 1 : -1;
  const rawSlope = tx / (signTy * Math.max(Math.abs(ty), 0.28));
  const slopeDxPerDy = 0.92 * Math.tanh(0.82 * rawSlope);

  const idealStartY = Math.min(hinge.y, tagCenter.y) - 6 * z;
  const spanRows = Math.max(0, Math.min(spanCount, 8) - 1);
  const maxStartY = Math.max(
    topMargin,
    effectiveBottom - spanRows * lineHeight * z,
  );
  const startY = clamp(idealStartY, topMargin, maxStartY);

  const obstacles: { x: number; y: number; r: number }[] = [
    { x: tagCenter.x, y: tagCenter.y, r: 28 * z },
  ];
  for (const localArc of [45, 90]) {
    const localS = arcOffsetS(hub, startS, localArc, u);
    const pt = worldToScreen(material(hub, localS, 22, u), camera, viewport);
    obstacles.push({ x: pt.x, y: pt.y, r: 19 * z });
  }

  const baseClearance = 34 * z;

  return Array.from({ length: lineCount }, (_, index) => {
    const y = startY + index * lineHeight * z - subLineOffset * z;
    const slotY = startY + index * lineHeight * z;
    const dyFromHinge = y - hinge.y;
    let spineX = hinge.x + slopeDxPerDy * dyFromHinge;
    if (Math.abs(1 - u) >= 1e-3) {
      const arcStep = (dyFromHinge / z) * signTy;
      const sampleS = arcOffsetS(hub, startS, arcStep, u);
      const curvePt = worldToScreen(material(hub, sampleS, 0, u), camera, viewport);
      if (Number.isFinite(curvePt.x)) {
        spineX = curvePt.x + slopeDxPerDy * (y - curvePt.y) * 0.35;
      }
    }
    spineX = clamp(
      spineX,
      side === 1 ? minLeftX : minLeftX + 140 * z,
      side === 1 ? maxRightX - 140 * z : maxRightX,
    );

    const slotSpineX = hinge.x + slopeDxPerDy * (slotY - hinge.y);
    let clearance = baseClearance;
    for (const obs of obstacles) {
      const dy = Math.abs(slotY - obs.y);
      if (dy < obs.r) {
        const chord = Math.sqrt(Math.max(0, obs.r * obs.r - dy * dy));
        const obsProtrusion = side * (obs.x - slotSpineX) + chord + 8 * z;
        if (obsProtrusion > clearance) clearance = obsProtrusion;
      }
    }
    clearance = Math.min(clearance, baseClearance + 58 * z);
    const badgeIndent = Math.max(0, (clearance - baseClearance) / z);
    const edgeX = clamp(
      spineX + side * clearance,
      minLeftX,
      maxRightX,
    );
    const rawAvailable =
      side === 1 ? maxRightX - edgeX : edgeX - minLeftX;
    const availableWidth = clamp(rawAvailable, 0, maxWidth);
    const rowSpan = Math.min(maxWidth, Math.max(120 * z, availableWidth));
    const anchorX = edgeX + side * (rowSpan * 0.5);

    return {
      anchor: { x: anchorX, y },
      baselineAngle: 0,
      availableWidth: Math.max(availableWidth, Math.min(maxWidth, 160 * z)),
      edgeX,
      spineX,
      side,
      hubEdge,
      badgeIndent,
      isAnchorRow: index === 0 || (index === 1 && lineCount > 1),
    };
  });
}

/**
 * Compute the inward contour pull-in (in unscaled row pixels) for a radial row around a circle hub.
 */
export function circularContourPullIn(
  rowIndex: number,
  progress: number,
  lineAngle: number,
  localCount = 2,
): number {
  const theta = rowIndex * lineAngle;
  const gazeDelta = (rowIndex - progress) * lineAngle;

  const distGaze = Math.abs(gazeDelta);
  const gazeClearance = distGaze < 0.04 ? 1 : Math.exp(-((Math.max(0, distGaze - 0.04) / 0.11) ** 2));
  const distOrigin = Math.abs(theta);
  const originClearance = distOrigin < 0.05 ? 1 : Math.exp(-((Math.max(0, distOrigin - 0.05) / 0.11) ** 2));

  let localClearance = 0;
  for (let i = 0; i < Math.min(3, localCount); i++) {
    const localTheta = ((i + 1) * 45) / R;
    const d = Math.abs(theta - localTheta);
    localClearance = Math.max(localClearance, 0.58 * Math.exp(-((d / 0.085) ** 2)));
  }

  const peerStep = 165 / R;
  const nearestPeer = Math.round(theta / peerStep) * peerStep;
  const peerClearance =
    Math.abs(nearestPeer) > 0.4
      ? 0.72 * Math.exp(-(((theta - nearestPeer) / 0.095) ** 2))
      : 0;

  const badgeFactor = clamp(
    Math.max(gazeClearance, originClearance, localClearance, peerClearance),
    0,
    1,
  );
  return 34 * (1 - ease(badgeFactor));
}
