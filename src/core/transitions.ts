/**
 * Shuyra's transition grammar describes a structural relationship, not a CSS animation.
 * Pure classification keeps navigation semantics independent from presentation and input.
 */
import type { HubDefinition, TransitionKind, Camera, Viewport } from "./types.ts";

export const MOTION = {
  morph: 840,
  focus: 820,
  page: 680,
  near: 620,
  flight: 880,
  axis: 820,
  remote: 1120,
  loading: 1180,
  resize: 250,
  scrollTimeConstant: 190,
  textTimeConstant: 110,
} as const;

const prefix = (shorter: readonly string[], longer: readonly string[]) =>
  shorter.every((id, index) => longer[index] === id);

/** Distinguish movement within a level, nesting, and crossing a boundary. */
export function classifyTransition(
  sourceHub: string,
  sourcePath: readonly string[],
  targetHub: string,
  targetPath: readonly string[],
): "traverse" | "unfold" | "fold" | "passage" {
  if (sourceHub !== targetHub) return "passage";
  if (
    sourcePath.length === targetPath.length &&
    sourcePath.slice(0, -1).every((id, i) => id === targetPath[i])
  ) return "traverse";
  if (sourcePath.length < targetPath.length && prefix(sourcePath, targetPath))
    return "unfold";
  if (targetPath.length < sourcePath.length && prefix(targetPath, sourcePath))
    return "fold";
  return "passage";
}

/** A common symmetric envelope: geometry takes over before the new text becomes legible. */
export function readingEnvelope(phase: number): number {
  const ease = (t: number) => {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  };
  if (phase < 0.46) return 1 - ease(phase / 0.46);
  if (phase > 0.54) return ease((phase - 0.54) / 0.46);
  return 0;
}

/** Keep reading text smoothly visible across circle↔line morph without a blank drop at 0.5. */
export function morphReadingEnvelope(morph: number): number {
  const x = Math.max(0, Math.min(1, Math.abs(morph - 0.5) / 0.12));
  const smooth = x * x * (3 - 2 * x);
  return 0.85 + 0.15 * smooth;
}

/**
 * One complete 360° revolution around the material-point hinge, shared by
 * circle and line. Front-facing old leaf (0..90°) exits; the reverse half
 * (90..270°) is never readable. The new leaf enters from 270..360°.
 * The semantic payload swaps at exactly 180°, hidden on the far side.
 */
export interface PagePose {
  angle: number;
  squash: number;
  opacity: number;
  incoming: boolean;
  interactive: boolean;
}
export function pageTurnPose(phase: number, reducedMotion = false, direction: 1 | -1 = 1): PagePose {
  const p = Math.max(0, Math.min(1, phase));
  if (reducedMotion) return {
    angle: 0, squash: 1, opacity: 1,
    incoming: p >= 0.5, interactive: p === 0 || p === 1,
  };
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const angle = direction * 360 * smooth(p);
  const projectedWidth = Math.cos((angle * Math.PI) / 180);
  return {
    angle,
    squash: Math.max(0.001, Math.abs(projectedWidth)),
    opacity: smooth(Math.max(0, Math.min(1, projectedWidth / 0.24))),
    incoming: p >= 0.5,
    interactive: p <= 0 || p >= 1,
  };
}

/** First classify relationship (explicit parentHub), then distance in viewports.
 * Freeze this decision at dispatch time: changing camera zoom cannot re-route it.
 */
export function selectSpatialTransition(
  source: HubDefinition,
  target: HubDefinition,
  camera: Camera,
  viewport: Viewport,
): Exclude<TransitionKind, "loading"> {
  if (source.parentHub === target.id || target.parentHub === source.id) return "axis";
  const distance = Math.hypot(source.center.x - target.center.x, source.center.y - target.center.y);
  const relative = (distance * camera.z) / Math.hypot(viewport.width, viewport.height);
  return relative < 0.45 ? "near" : relative < 1.15 ? "flight" : "remote";
}
