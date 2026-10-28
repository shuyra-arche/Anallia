import type { Vec, Viewport } from "./types.ts";

export function readingWidth(viewport: Viewport, long: boolean): number {
  const width = viewport.width;
  return width < 700
    ? Math.min(268, Math.max(185, width * 0.58))
    : long
      ? Math.min(364, Math.max(284, width * 0.27))
      : Math.min(316, Math.max(244, width * 0.23));
}

export interface ReadingPlacement {
  left: number;
  top: number;
  originX: number;
  originY: number;
  side: "left" | "right";
}

/** Keep the whole upright reading window outside the curve's tangent half-plane.
 * Direction comes from geometry, never from remaining viewport space. */
export function placeReading(
  anchor: Vec,
  normal: Vec,
  width: number,
  height: number,
  scale = 1,
): ReadingPlacement {
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const originX = width * clamp01(0.5 - normal.x * 1.6);
  const originY = height * clamp01(0.5 - normal.y * 1.6);
  const inward =
    Math.min(0, normal.x * width) +
    Math.min(0, normal.y * height) -
    normal.x * originX -
    normal.y * originY;
  const clearance = Math.max(0, -inward);
  return {
    left: anchor.x + (normal.x * clearance - originX) * scale,
    top: anchor.y + (normal.y * clearance - originY) * scale,
    originX,
    originY,
    side: normal.x < 0 ? "left" : "right",
  };
}

export function readingHeight(
  viewport: Viewport,
  scale = 1,
  normalY = 0,
): number {
  const safeScale = Math.max(0.18, scale);
  const verticalBias = Math.min(1, Math.abs(normalY));
  const viewportCap = (viewport.height - 144) / safeScale;
  const localCap = Math.max(
    360,
    Math.min(430 - 65 * verticalBias, viewport.height * 0.56),
  );
  return Math.max(80, Math.min(viewportCap, localCap));
}

export type ReadingClipEdge = "top" | "bottom";

export interface ReadingClipState {
  /** The single truncation boundary that prevents long text from overlapping the hub. */
  edge: ReadingClipEdge;
  /** Fade transition band depth in local article pixels (0 when no text crosses the boundary). */
  fadePx: number;
  /** CSS mask-image value for the single truncation boundary ("none" when inactive). */
  maskImage: string;
  /** Local window top margin adjustment (negative when extending open top upward). */
  windowMarginTop: number;
  /** Local window top padding adjustment (positive when extending open top upward). */
  windowPaddingTop: number;
  /** Local window height so only `edge` truncates while the opposite side stays open. */
  windowHeight: number;
}

export const READING_CLIP_FADE_PX = 48;

/**
 * Dynamically determine the single truncation boundary (`top` vs `bottom`) from the
 * outward tangent normal so long text never overlaps the hub while the opposite side
 * remains open, with a smooth alpha gradient transition at the active boundary.
 */
export function resolveReadingClip(
  normal: Vec,
  contentHeight: number,
  panelHeight: number,
  activeFloat: number,
): ReadingClipState {
  const edge: ReadingClipEdge = normal.y < 0 ? "bottom" : "top";
  if (edge === "top") {
    const overflowPx = Math.max(0, activeFloat);
    const fadePx =
      overflowPx > 1
        ? Math.min(READING_CLIP_FADE_PX, overflowPx * 1.25, panelHeight * 0.45)
        : 0;
    const maskImage =
      fadePx > 0
        ? `linear-gradient(to bottom, rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 0.38) ${(fadePx * 0.45).toFixed(1)}px, rgba(0, 0, 0, 1) ${fadePx.toFixed(1)}px)`
        : "none";
    return {
      edge,
      fadePx,
      maskImage,
      windowMarginTop: 0,
      windowPaddingTop: 0,
      windowHeight: Math.max(panelHeight, contentHeight - activeFloat),
    };
  }
  const topExtend = Math.max(0, activeFloat);
  const bottomOverflowPx = Math.max(
    0,
    contentHeight - panelHeight - activeFloat,
  );
  const fadePx =
    bottomOverflowPx > 1
      ? Math.min(
          READING_CLIP_FADE_PX,
          bottomOverflowPx * 1.25,
          panelHeight * 0.45,
        )
      : 0;
  const maskImage =
    fadePx > 0
      ? `linear-gradient(to top, rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 0.38) ${(fadePx * 0.45).toFixed(1)}px, rgba(0, 0, 0, 1) ${fadePx.toFixed(1)}px)`
      : "none";
  return {
    edge,
    fadePx,
    maskImage,
    windowMarginTop: -topExtend,
    windowPaddingTop: topExtend,
    windowHeight: panelHeight + topExtend,
  };
}

export interface AdaptiveLayout {
  side: 1 | -1;
  vertical: 1 | -1;
  width: number;
  /** The article is arranged in screen coordinates; its semantic hinge stays at anchor. */
  left: number;
  top: number;
  /** Whether the content must share the screen below/above the hinge. */
  stacked: boolean;
}
/** Only choose a direction. Never clamp, recenter or compress the article
 * to fit the viewport: text may extend beyond its edges. */
export function chooseAdaptiveLayout(
  anchor: Vec,
  viewport: Viewport,
  preferredWidth: number,
  measuredHeight: number,
  previous?: { side: 1 | -1; vertical: 1 | -1 },
): AdaptiveLayout {
  const margin = 76;
  const leftSpace = anchor.x;
  const rightSpace = viewport.width - anchor.x;
  const prior = previous?.side ?? (rightSpace >= leftSpace ? 1 : -1);
  const own = prior === 1 ? rightSpace : leftSpace;
  const other = prior === 1 ? leftSpace : rightSpace;
  const side: 1 | -1 =
    other > own + Math.max(48, preferredWidth * 0.18)
      ? prior === 1
        ? -1
        : 1
      : prior;
  const above = anchor.y;
  const below = viewport.height - anchor.y;
  const before = previous?.vertical ?? (below >= above ? 1 : -1);
  const vertical: 1 | -1 =
    before === 1 && above > below + 90
      ? -1
      : before === -1 && below > above + 90
        ? 1
        : before;
  const width = preferredWidth;
  return {
    side,
    vertical,
    width,
    left: side === 1 ? anchor.x + margin : anchor.x - margin - width,
    top: vertical === 1 ? anchor.y - 58 : anchor.y - measuredHeight + 58,
    stacked: false,
  };
}
