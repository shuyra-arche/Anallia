import { clamp } from "./math.ts";
/** Local entries occupy the geometric gap adjacent to the focused ordinary tag.
 * There is no independent toolbar: the geometry itself supplies their positions.
 * Entries extend in ordinary-label sequence order, in local arc-length units.
 */
export interface LocalBand {
  direction: 1;
  capacity: number;
  step: number;
  maxScroll: number;
}
export function planLocalBand(after: number | null, count: number): LocalBand {
  const step = 45;
  const slots = (gap: number | null) =>
    gap === null ? 4 : Math.max(1, Math.min(4, Math.floor((gap - 30) / step)));
  const afterSlots = slots(after);
  const capacity = Math.min(Math.max(1, count), afterSlots);
  return {
    direction: 1,
    capacity,
    step,
    maxScroll: Math.max(0, count - capacity),
  };
}
export function localVisible(
  index: number,
  scroll: number,
  band: LocalBand,
): { arc: number; opacity: number } | null {
  const slot = index - clamp(scroll, 0, band.maxScroll);
  if (slot < -0.001 || slot > band.capacity - 0.001) return null;
  const fade = Math.min(1, (slot + 0.12) / 0.35, (band.capacity - slot) / 0.35);
  return {
    arc: band.direction * (slot + 1) * band.step,
    opacity: clamp(fade, 0, 1),
  };
}
