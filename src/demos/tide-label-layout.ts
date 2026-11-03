import type { LabelFrame, SceneFrame } from "../core/graphics.ts";
import type { FieldState, Vec } from "../core/types.ts";

export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const LABEL_GAP = 8;
export function labelBox(
  label: LabelFrame,
  at = label.layout.position,
): LabelBox {
  const l = label.layout,
    a = (l.degree * Math.PI) / 180;
  const half =
    ((Math.abs(Math.cos(a)) * l.width + Math.abs(Math.sin(a)) * l.height) *
      l.scale) /
    2;
  const hy =
    ((Math.abs(Math.sin(a)) * l.width + Math.abs(Math.cos(a)) * l.height) *
      l.scale) /
    2;
  return {
    left: at.x - half,
    right: at.x + half,
    top: at.y - hy,
    bottom: at.y + hy,
  };
}
export function intersects(a: LabelBox, b: LabelBox, gap = LABEL_GAP): boolean {
  return (
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap
  );
}
/** Keep font size; abbreviate the compact glyph, never its accessible full title. */
export function fitTideGlyph(label: LabelFrame, width: number): LabelFrame {
  if (label.icon || label.layout.width * label.layout.scale <= width)
    return label;
  const capacity = Math.max(
    2,
    Math.floor((width / label.layout.scale - 20) / 14),
  );
  const glyph = [...label.glyph].slice(0, capacity - 1).join("") + "…";
  return {
    ...label,
    glyph,
    layout: {
      ...label.layout,
      width: Math.max(44, [...glyph].length * 14 + 20),
    },
  };
}

/** One collision contract for target AND rendered poses, including retiring leaves.
 * Keep material hinges; move only the leaf. No feasible slot => no drawing or hit,
 * never a knowingly overlapping fallback to the original position. */
export function arrangeTideLabels(
  labels: readonly LabelFrame[],
  state: Readonly<FieldState>,
  frame: Readonly<SceneFrame>,
  previous: ReadonlyMap<string, Vec> = new Map(),
  wanted = new Set(labels.map((l) => l.id)),
  travel = Infinity,
): LabelFrame[] {
  const top = state.viewport.width <= 700 ? 116 : 122;
  const paper = state.overview
    ? []
    : frame.reading
        .filter((r) => r.visible && r.opacity > 0.01)
        .map((r) => ({
          left: r.left,
          top: r.top,
          right: r.left + r.width,
          bottom: r.top + r.height,
        }));
  const occupied: LabelBox[] = [...paper];
  const native = (l: LabelFrame) =>
    l.attachment?.role === "ordinary" && l.visual === "current";
  const priority = (l: LabelFrame) =>
    !wanted.has(l.id)
      ? 5
      : native(l)
        ? 0
        : l.command.type === "scroll-local"
          ? 1
          : l.visual === "current"
            ? 2
            : 3;
  const order = labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => priority(a.label) - priority(b.label) || a.index - b.index);
  const placed = new Map<string, LabelFrame>();
  for (const { label } of order) {
    if (label.opacity <= 0.001 || label.page?.opacity === 0) {
      placed.set(label.id, { ...label, interactive: false });
      continue;
    }
    const box = labelBox(label),
      hw = (box.right - box.left) / 2,
      hh = (box.bottom - box.top) / 2;
    const preferred = label.layout.position,
      last = previous.get(label.id) ?? preferred;
    const valid = (p: Vec) =>
      p.x - hw >= 6 &&
      p.x + hw <= state.viewport.width - 6 &&
      p.y - hh >= top &&
      p.y + hh <= state.viewport.height - 6 &&
      !occupied.some((other) => intersects(labelBox(label, p), other));
    let at: Vec | undefined = valid(preferred) ? preferred : undefined;
    if (!at) {
      const xs = new Set([
        preferred.x,
        last.x,
        hw + 6,
        state.viewport.width - hw - 6,
      ]);
      const ys = new Set([
        preferred.y,
        last.y,
        top + hh,
        state.viewport.height - hh - 6,
      ]);
      for (const obstacle of occupied) {
        xs.add(obstacle.left - hw - LABEL_GAP);
        xs.add(obstacle.right + hw + LABEL_GAP);
        ys.add(obstacle.top - hh - LABEL_GAP);
        ys.add(obstacle.bottom + hh + LABEL_GAP);
      }
      let score = Infinity;
      for (const x of xs)
        for (const y of ys) {
          const p = { x, y };
          if (!valid(p)) continue;
          const value =
            (x - preferred.x) ** 2 +
            (y - preferred.y) ** 2 +
            0.4 * ((x - last.x) ** 2 + (y - last.y) ** 2);
          if (value < score) {
            at = p;
            score = value;
          }
        }
    }
    if (!at) {
      placed.set(label.id, { ...label, opacity: 0, interactive: false });
      continue;
    }
    // Follow a short collision-free route, rather than teleporting to an
    // available slot when an interpolated leaf meets the paper or another leaf.
    if (previous.has(label.id) && Number.isFinite(travel)) {
      const obstacles = occupied.map((b) => ({
        left: b.left - hw - LABEL_GAP,
        right: b.right + hw + LABEL_GAP,
        top: b.top - hh - LABEL_GAP,
        bottom: b.bottom + hh + LABEL_GAP,
      }));
      at = advance(last, at, travel, obstacles, valid);
      if (!valid(at)) {
        placed.set(label.id, {
          ...label,
          opacity: 0,
          interactive: false,
          layout: {
            ...label.layout,
            position: at,
            offset: {
              x: (at.x - label.layout.hinge.x) / label.layout.scale,
              y: (at.y - label.layout.hinge.y) / label.layout.scale,
            },
          },
        });
        continue;
      }
    }
    const next = {
      ...label,
      layout: {
        ...label.layout,
        position: at,
        offset: {
          x: (at.x - label.layout.hinge.x) / label.layout.scale,
          y: (at.y - label.layout.hinge.y) / label.layout.scale,
        },
      },
    };
    occupied.push(labelBox(next));
    placed.set(label.id, next);
  }
  return labels.map((label) => placed.get(label.id)!);
}

/** Visibility graph around expanded rectangles. Presentation-only waypoints;
 * identity, material hinge and navigation remain owned by the field. */
function advance(
  from: Vec,
  goal: Vec,
  travel: number,
  boxes: LabelBox[],
  valid: (p: Vec) => boolean,
): Vec {
  const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
  const toward = (a: Vec, b: Vec, n: number) => {
    const d = distance(a, b),
      t = d ? Math.min(1, n / d) : 1;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const clear = (a: Vec, b: Vec) =>
    !boxes.some((r) => {
      let lo = 0,
        hi = 1;
      for (const [p, d, min, max] of [
        [a.x, b.x - a.x, r.left + 0.01, r.right - 0.01],
        [a.y, b.y - a.y, r.top + 0.01, r.bottom - 0.01],
      ]) {
        if (Math.abs(d) < 1e-8) {
          if (p <= min || p >= max) return false;
        } else {
          const u = (min - p) / d,
            v = (max - p) / d;
          lo = Math.max(lo, Math.min(u, v));
          hi = Math.min(hi, Math.max(u, v));
        }
      }
      return hi > lo && hi > 0 && lo < 1;
    });
  if (!valid(from) || clear(from, goal)) return toward(from, goal, travel);
  const nodes = [
    from,
    goal,
    ...boxes
      .flatMap((r) => [
        { x: r.left - 0.1, y: r.top - 0.1 },
        { x: r.right + 0.1, y: r.top - 0.1 },
        { x: r.left - 0.1, y: r.bottom + 0.1 },
        { x: r.right + 0.1, y: r.bottom + 0.1 },
      ])
      .filter(valid),
  ];
  const cost = nodes.map(() => Infinity),
    parent = nodes.map(() => -1),
    done = new Set<number>();
  cost[0] = 0;
  for (let n = 0; n < nodes.length; n++) {
    let at = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!done.has(i) && (at < 0 || cost[i] < cost[at])) at = i;
    if (at < 0 || !Number.isFinite(cost[at]) || at === 1) break;
    done.add(at);
    for (let j = 0; j < nodes.length; j++)
      if (!done.has(j) && clear(nodes[at], nodes[j])) {
        const next = cost[at] + distance(nodes[at], nodes[j]);
        if (next < cost[j]) {
          cost[j] = next;
          parent[j] = at;
        }
      }
  }
  if (parent[1] < 0) return from;
  const route = [1];
  while (parent[route[0]] > 0) route.unshift(parent[route[0]]);
  let at = from;
  for (const i of route) {
    const d = distance(at, nodes[i]);
    if (d > travel) return toward(at, nodes[i], travel);
    travel -= d;
    at = nodes[i];
  }
  return at;
}

/** The page transform also moves the leaf toward its material hinge. Preserve
 * that hinge, fading at an obstruction before the folded glyph can cross it. */
export function protectTideLeafVisibility(
  labels: readonly LabelFrame[],
  state: Readonly<FieldState>,
  frame: Readonly<SceneFrame>,
): LabelFrame[] {
  const occupied: LabelBox[] = state.overview
    ? []
    : frame.reading
        .filter((r) => r.visible && r.opacity > 0.01)
        .map((r) => ({
          left: r.left,
          right: r.left + r.width,
          top: r.top,
          bottom: r.top + r.height,
        }));
  return labels.map((label) => {
    const l = label.layout,
      angle = (l.degree * Math.PI) / 180,
      axis = Math.atan2(l.offset.y, l.offset.x),
      ux = Math.cos(axis),
      uy = Math.sin(axis),
      squash = label.page?.squash ?? 1;
    const points = [-1, 1].flatMap((x) =>
      [-1, 1].map((y) => {
        const px =
          l.offset.x +
          (x * l.width * Math.cos(angle) - y * l.height * Math.sin(angle)) / 2;
        const py =
            l.offset.y +
            (x * l.width * Math.sin(angle) + y * l.height * Math.cos(angle)) /
              2,
          dot = px * ux + py * uy;
        return {
          x: l.hinge.x + (px + (squash - 1) * dot * ux) * l.scale,
          y: l.hinge.y + (py + (squash - 1) * dot * uy) * l.scale,
        };
      }),
    );
    const b = {
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      bottom: Math.max(...points.map((p) => p.y)),
    };
    let clearance = Math.min(
      (b.left * 8) / 6,
      ((state.viewport.width - b.right) * 8) / 6,
      ((b.top - 110) * 8) / 6,
      ((state.viewport.height - b.bottom) * 8) / 6,
    );
    for (const other of occupied)
      clearance = Math.min(
        clearance,
        Math.max(
          other.left - b.right,
          b.left - other.right,
          other.top - b.bottom,
          b.top - other.bottom,
        ),
      );
    const t = Math.max(0, Math.min(1, clearance / 8)),
      alpha = t * t * (3 - 2 * t);
    const result = {
      ...label,
      opacity: label.opacity * alpha,
      interactive: label.interactive && alpha > 0.98,
    };
    if (result.opacity * (label.page?.opacity ?? 1) > 0.001) occupied.push(b);
    return result;
  });
}
