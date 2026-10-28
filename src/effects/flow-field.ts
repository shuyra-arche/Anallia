import type { Vec } from "../core/types.ts";
export interface WaveImpulse {
  center: Vec;
  started: number;
  maxRadius: number;
}
export interface FlowSample {
  velocity: Vec;
  disturbance: number;
}
const vortices = [
  { x: -540, y: -180, radius: 620, strength: 58 },
  { x: 510, y: 350, radius: 680, strength: -52 },
  { x: 30, y: -440, radius: 470, strength: 36 },
  { x: -860, y: -340, radius: 560, strength: -44 },
  { x: 1080, y: -440, radius: 640, strength: 48 },
];
/** World-space velocity: a smooth solenoidal flow plus transient radial waves. */
export function sampleFlow(
  point: Vec,
  elapsed: number,
  impulses: readonly WaveImpulse[],
): FlowSample {
  const time = elapsed / 1000;
  let x = 18 + 5 * Math.sin(point.y / 700 + time * 0.075);
  let y = 7 * Math.sin(point.x / 850 - time * 0.055);
  for (const vortex of vortices) {
    const dx = (point.x - vortex.x) / vortex.radius,
      dy = (point.y - vortex.y) / vortex.radius;
    const strength = vortex.strength * Math.exp(-(dx * dx + dy * dy) * 0.7);
    x -= dy * strength;
    y += dx * strength;
  }
  let disturbance = 0;
  for (const impulse of impulses) {
    const age = (elapsed - impulse.started) / 1000;
    if (age <= 0 || age >= 2.2) continue;
    const dx = point.x - impulse.center.x,
      dy = point.y - impulse.center.y,
      r = Math.hypot(dx, dy);
    if (r < 1e-6) continue;
    const distance = r - (impulse.maxRadius * age) / 2.2;
    const envelope =
      Math.exp(-((distance / 105) ** 2)) * Math.sin((Math.PI * age) / 2.2) ** 2;
    const wave = 27 * envelope * Math.sin(distance / 34);
    x += (dx / r) * wave;
    y += (dy / r) * wave;
    disturbance += Math.abs(wave) / 27;
  }
  return { velocity: { x, y }, disturbance: Math.min(1, disturbance) };
}
