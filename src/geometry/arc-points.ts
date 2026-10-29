import type { ArcPrimitive } from "../core/graphics.ts";
import type { Vec } from "../core/types.ts";

/** Bounded numeric sampling for dashed GPU arcs, following SVG sweep semantics. */
export function arcPoints(
  arc: Pick<
    ArcPrimitive,
    "cx" | "cy" | "radius" | "startAngle" | "endAngle" | "anticlockwise"
  >,
): Vec[] {
  const { cx, cy, radius, startAngle, endAngle } = arc;
  if (
    !(radius > 0) ||
    ![cx, cy, radius, startAngle, endAngle].every(Number.isFinite)
  )
    return [];
  const turn = Math.PI * 2,
    delta = endAngle - startAngle,
    direction = arc.anticlockwise ? -1 : 1;
  const span =
    Math.abs(delta) >= turn - 1e-8
      ? turn
      : (((direction * delta) % turn) + turn) % turn;
  if (span < 1e-12) return [];
  const maxAngle = Math.min(
    3 / radius,
    2 * Math.acos(Math.max(-1, 1 - 0.05 / radius)),
  );
  const steps = Math.min(
    2048,
    Math.max(2, Math.ceil(span / Math.max(1e-8, maxAngle))),
  );
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = startAngle + (direction * span * i) / steps;
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
}
