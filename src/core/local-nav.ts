import { clamp } from './math.ts';
/** Local entries occupy the geometric gap adjacent to the focused ordinary tag.
 * There is no independent toolbar: the geometry itself supplies their positions.
 * Values are measured in screen-stable arc-length units.
 */
export interface LocalBand {
  direction: -1 | 1;
  capacity: number;
  step: number;
  maxScroll: number;
}
export function planLocalBand(
  before: number | null,
  after: number | null,
  count: number,
  previousDirection: -1 | 1 = 1,
): LocalBand {
  const step = 45;
  const slots = (gap: number | null) => gap === null ? 4 : Math.max(1, Math.min(4, Math.floor((gap - 30) / step)));
  const beforeSlots = slots(before);
  const afterSlots = slots(after);
  const direction: -1 | 1 = beforeSlots > afterSlots ? -1
    : afterSlots > beforeSlots ? 1 : previousDirection;
  const capacity = Math.min(Math.max(1, count), direction === 1 ? afterSlots : beforeSlots);
  return { direction, capacity, step, maxScroll: Math.max(0, count - capacity) };
}
export function localVisible(index: number, scroll: number, band: LocalBand): { arc: number; opacity: number } | null {
  const slot = index - clamp(scroll, 0, band.maxScroll);
  if (slot < -0.001 || slot > band.capacity - 0.001) return null;
  const fade = Math.min(1, (slot + 0.12) / 0.35, (band.capacity - slot) / 0.35);
  return {arc: band.direction * (slot + 1) * band.step, opacity: clamp(fade, 0, 1)};
}
