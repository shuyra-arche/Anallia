import type { Vec } from "../core/types.ts";

export interface StrokeClip { left: number; top: number; right: number; bottom: number }

function segmentRange(from: Vec, to: Vec, clip: StrokeClip): [number, number] | null {
  let start = 0, end = 1;
  for (const [origin, delta, low, high] of [
    [from.x, to.x - from.x, clip.left, clip.right],
    [from.y, to.y - from.y, clip.top, clip.bottom],
  ]) {
    if (delta === 0) { if (origin < low || origin > high) return null; continue; }
    const a = (low - origin) / delta, b = (high - origin) / delta;
    start = Math.max(start, Math.min(a, b));
    end = Math.min(end, Math.max(a, b));
    if (start >= end) return null;
  }
  return [start, end];
}

/** Visible dash subpaths; phase advances across the entire source path, including clipped gaps. */
export function clippedDashes(points: readonly Vec[], dash: readonly number[], clip: StrokeClip): Vec[][] {
  if (points.length < 2 || ![clip.left, clip.top, clip.right, clip.bottom].every(Number.isFinite)
    || clip.left >= clip.right || clip.top >= clip.bottom
    || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return [];
  const pattern = dash.filter(value => Number.isFinite(value) && value > 0);
  if (pattern.length % 2) pattern.push(...pattern);
  const period = pattern.reduce((sum, value) => sum + value, 0);
  if (!(period > 0) || !Number.isFinite(period)) return [];
  const paths: Vec[][] = [];
  let travelled = 0, current: Vec[] | null = null;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (!Number.isFinite(length)) return [];
    if (length === 0) continue;
    const range = segmentRange(from, to, clip);
    if (!range) { travelled = (travelled + length) % period; current = null; continue; }
    const [start, end] = range;
    const visible = (end - start) * length;
    let phase = (travelled + start * length) % period, index = 0;
    while (index < pattern.length - 1 && phase >= pattern[index]) phase -= pattern[index++];
    let remaining = pattern[index] - phase, along = 0;
    if (start > 0) current = null;
    while (along < visible) {
      const step = Math.min(remaining, visible - along);
      const next = along + step;
      if (!(next > along)) break;
      const a = start + along / length, b = start + next / length;
      if (index % 2 === 0) {
        if (!current) { current = [{ x: from.x + dx * a, y: from.y + dy * a }]; paths.push(current); }
        current.push({ x: from.x + dx * b, y: from.y + dy * b });
      } else current = null;
      along = next; remaining -= step;
      if (remaining <= 1e-8) {
        index = (index + 1) % pattern.length; remaining = pattern[index];
        if (index % 2) current = null;
      }
    }
    if (end < 1) current = null;
    travelled = (travelled + length) % period;
  }
  return paths;
}
