import type { Vec, Viewport } from "./types.ts";

export function readingWidth(viewport: Viewport, long: boolean): number {
  const width = viewport.width;
  return width < 700
    ? Math.min(285, Math.max(185, width * 0.62))
    : long
      ? Math.min(435, Math.max(305, width * 0.34))
      : Math.min(355, Math.max(265, width * 0.29));
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
