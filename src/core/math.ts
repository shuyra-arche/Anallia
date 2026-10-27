import type { Vec } from "./types.ts";
export const V = (x = 0, y = 0): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => V(a.x + b.x, a.y + b.y);
export const sub = (a: Vec, b: Vec): Vec => V(a.x - b.x, a.y - b.y);
export const mul = (a: Vec, k: number): Vec => V(a.x * k, a.y * k);
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const unit = (a: Vec): Vec => mul(a, 1 / (len(a) || 1));
export function cDiv(a: Vec, b: Vec): Vec {
  const d = b.x * b.x + b.y * b.y || 1e-9;
  return V((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}
export const clamp = (x: number, a: number, b: number): number =>
  Math.max(a, Math.min(b, x));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export function ease(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}
export function quint(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}
export const unwrapAngle = (a: number, b: number): number =>
  a + (((b - a + 540) % 360) - 180);
export function rot(a: Vec, rad: number): Vec {
  const c = Math.cos(rad),
    s = Math.sin(rad);
  return V(a.x * c - a.y * s, a.x * s + a.y * c);
}
