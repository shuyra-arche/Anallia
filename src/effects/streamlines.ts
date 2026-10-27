import type { Vec } from "../core/types.ts";
import { sampleFlow, type WaveImpulse } from "./flow-field.ts";
/** Midpoint integration in world space; bounded steps preserve sparse, smooth curves. */
export function traceStreamline(
  seed: Vec,
  elapsed: number,
  impulses: readonly WaveImpulse[],
  steps = 24,
  spacing = 22,
): Vec[] {
  const branch = (direction: number) => {
    const points: Vec[] = [];
    let point = { ...seed };
    for (let i = 0; i < steps; i++) {
      const first = sampleFlow(point, elapsed, impulses).velocity,
        length = Math.hypot(first.x, first.y);
      if (length < 1e-6) break;
      const half = {
        x: point.x + (direction * spacing * first.x) / length / 2,
        y: point.y + (direction * spacing * first.y) / length / 2,
      };
      const middle = sampleFlow(half, elapsed, impulses).velocity,
        speed = Math.hypot(middle.x, middle.y);
      if (speed < 1e-6) break;
      point = {
        x: point.x + (direction * spacing * middle.x) / speed,
        y: point.y + (direction * spacing * middle.y) / speed,
      };
      points.push(point);
    }
    return points;
  };
  return [...branch(-1).reverse(), seed, ...branch(1)];
}
export function flowSeeds(center: Vec): Vec[] {
  const column = Math.floor(center.x / 340),
    row = Math.floor(center.y / 270),
    seeds: Vec[] = [];
  for (let y = -2; y <= 2; y++)
    for (let x = -3; x <= 3; x++) {
      const col = column + x,
        line = row + y;
      seeds.push({
        x: col * 340 + 60 * Math.sin(line * 1.71 + col * 0.63),
        y: line * 270 + 45 * Math.cos(col * 1.37 - line * 0.81),
      });
    }
  return seeds;
}
