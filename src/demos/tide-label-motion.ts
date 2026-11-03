import type { Catalog } from "../content/catalog.ts";
import type { FieldState, Vec } from "../core/types.ts";
import type {
  LabelFrame,
  LabelLayout,
  SceneFrame,
  ScenePrimitive,
} from "../core/graphics.ts";
import { clamp, ease, mix } from "../core/math.ts";
import { labelHitRegion } from "../geometry/labels.ts";
import { hubInk } from "../core/palette.ts";
import {
  arrangeTideLabels,
  protectTideLeafVisibility,
} from "./tide-label-layout.ts";
import { projectTideFrame } from "./tide-hub.ts";
import type { SymbolInteractionState } from "../rendering/semantic-feedback.ts";

type Leaf = {
  frame: LabelFrame;
  from: LabelLayout;
  fromOpacity: number;
  target: LabelLayout;
  lastDelta: Vec;
  started: number;
  duration: number;
  phase: "entering" | "moving" | "leaving" | "settled";
};
const point = (a: Vec, b: Vec, t: number): Vec => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
});
const copyLayout = (l: LabelLayout): LabelLayout => ({
  ...l,
  hinge: { ...l.hinge },
  position: { ...l.position },
  offset: { ...l.offset },
});
const folded = (l: LabelLayout): LabelLayout => ({
  ...copyLayout(l),
  position: { ...l.hinge },
  offset: { x: 0, y: 0 },
});

/** Short-lived presentation poses only. Field owns every command, location and clock.
 * Stable chapter IDs let a leaf reflow or reverse from its current visible pose.
 * Departing leaves never remain in the command/hit table. */
export class TideLabelMotion {
  private leaves = new Map<string, Leaf>();
  private layoutKey = "";
  private moving = false;
  private lastTime: number | null = null;
  private readonly catalog: Catalog;
  constructor(catalog: Catalog) {
    this.catalog = catalog;
  }
  get isAnimating(): boolean {
    return this.moving;
  }
  clear(): void {
    this.leaves.clear();
    this.lastTime = null;
    this.layoutKey = "";
    this.moving = false;
  }

  project = (
    base: Readonly<SceneFrame>,
    state: Readonly<FieldState>,
    feedback: ReadonlyMap<string, SymbolInteractionState>,
  ): SceneFrame => {
    const travel =
      state.settings.reducedMotion || this.lastTime === null
        ? Infinity
        : Math.max(0, state.elapsed - this.lastTime);
    this.lastTime = state.elapsed;
    const previous = new Map(
      [...this.leaves].map(([id, leaf]) => [id, leaf.frame.layout.position]),
    );
    // A hub handoff is exclusive, including overview focus changes without a portal.
    for (const [id, leaf] of this.leaves)
      if (leaf.frame.color?.hub !== state.focus) this.leaves.delete(id);
    const desired = projectTideFrame(base, state, this.catalog, feedback);
    const managed = (label: LabelFrame) =>
      label.id.includes(":tide:") ||
      (state.viewport.width <= 700 && label.attachment?.role === "ordinary");
    const own = desired.labels.filter(managed);
    const wanted = new Map(own.map((label) => [label.id, label]));
    const hub = state.hubs[state.focus];
    const key = JSON.stringify([
      state.focus,
      hub.path,
      hub.targetMorph,
      state.overview,
      state.viewport,
      own
        .filter((label) => label.id.includes(":tide:"))
        .map((label) => [label.id, label.glyph]),
    ]);
    const changed = key !== this.layoutKey;
    const initial = this.layoutKey === "";
    this.layoutKey = key;
    this.moving = false;
    const now = state.elapsed;
    const duration = state.morphTurn
      ? Math.max(1, state.morphTurn.duration * (1 - state.morphTurn.phase))
      : 240;
    let out: LabelFrame[] = desired.labels.filter((label) => !managed(label));

    for (const [id, leaf] of this.leaves)
      if (!wanted.has(id)) {
        if (desired.labels.some((label) => label.id === id)) {
          this.leaves.delete(id);
          continue; // Hand back a native leaf after a viewport change.
        }
        // A structural midpoint is already invisible, so don't resurrect old
        // payloads on the incoming side of a page/portal.
        if (
          state.settings.reducedMotion ||
          state.contentTurn?.committed ||
          state.passage?.committed
        ) {
          this.leaves.delete(id);
          continue;
        }
        if (leaf.phase !== "leaving") {
          leaf.from = copyLayout(leaf.frame.layout);
          leaf.fromOpacity = leaf.frame.opacity;
          leaf.started = now;
          leaf.duration = 240;
          leaf.phase = "leaving";
        }
      }
    for (const target of own) {
      let leaf = this.leaves.get(target.id);
      const delta = leaf
        ? {
            x: target.layout.position.x - leaf.target.position.x,
            y: target.layout.position.y - leaf.target.position.y,
          }
        : { x: 0, y: 0 };
      const step = Math.hypot(delta.x, delta.y);
      // A body/edge reflow may happen before an earlier reflow has finished.
      // Retarget sharp jumps or reversals from the visible pose; smoothly moving
      // camera targets continue following the current clock without restarting it.
      const reflow =
        leaf &&
        !state.morphTurn &&
        step > 28 &&
        (step > Math.hypot(leaf.lastDelta.x, leaf.lastDelta.y) * 3 ||
          delta.x * leaf.lastDelta.x + delta.y * leaf.lastDelta.y < 0);
      if (!leaf) {
        const immediate =
          initial ||
          state.settings.reducedMotion ||
          !!state.contentTurn ||
          !!state.passage;
        leaf = {
          frame: target,
          from: immediate ? copyLayout(target.layout) : folded(target.layout),
          fromOpacity: immediate ? target.opacity : 0,
          target: copyLayout(target.layout),
          lastDelta: { x: 0, y: 0 },
          started: now,
          duration,
          phase: immediate ? "settled" : "entering",
        };
        this.leaves.set(target.id, leaf);
      } else if (changed || leaf.phase === "leaving" || reflow) {
        leaf.from = copyLayout(leaf.frame.layout);
        leaf.fromOpacity = leaf.frame.opacity;
        leaf.started = now;
        leaf.duration = duration;
        leaf.phase = "moving";
      }
      leaf.target = copyLayout(target.layout);
      leaf.lastDelta = delta;
    }
    for (const [id, leaf] of this.leaves) {
      const target = wanted.get(id);
      const progress = state.settings.reducedMotion
        ? 1
        : clamp((now - leaf.started) / leaf.duration, 0, 1);
      const t = leaf.phase === "settled" ? 1 : ease(progress);
      if (leaf.phase === "leaving" && progress === 1) {
        this.leaves.delete(id);
        continue;
      }
      const destination = target?.layout ?? folded(leaf.from);
      const materialLeaf =
        (target ?? leaf.frame).attachment?.role === "ordinary";
      const hinge =
        materialLeaf && target
          ? target.layout.hinge
          : point(leaf.from.hinge, destination.hinge, t);
      const position = point(leaf.from.position, destination.position, t);
      const scale = mix(leaf.from.scale, destination.scale, t);
      const leaving = leaf.phase === "leaving";
      const opacity = mix(leaf.fromOpacity, leaving ? 0 : target!.opacity, t);
      const source = target ?? leaf.frame;
      const frame: LabelFrame = {
        ...source,
        opacity: materialLeaf && target ? target.opacity : opacity,
        interactive:
          !leaving &&
          source.interactive &&
          (leaf.phase === "settled" || progress === 1),
        layout: {
          ...destination,
          hinge,
          position,
          scale,
          offset: {
            x: (position.x - hinge.x) / scale,
            y: (position.y - hinge.y) / scale,
          },
        },
      };
      leaf.frame = frame;
      if (progress === 1 && !leaving) leaf.phase = "settled";
      if (leaf.phase !== "settled") this.moving = true;
      out.push(frame);
    }
    out = arrangeTideLabels(
      out.filter((label) => label.color?.hub === state.focus),
      state,
      base,
      previous,
      new Set(desired.labels.map((label) => label.id)),
      travel,
    );
    for (const label of out) {
      const target = desired.labels.find((item) => item.id === label.id);
      const last = previous.get(label.id);
      if (
        target &&
        last &&
        Math.hypot(
          label.layout.position.x - last.x,
          label.layout.position.y - last.y,
        ) > 0.01 &&
        Math.hypot(
          label.layout.position.x - target.layout.position.x,
          label.layout.position.y - target.layout.position.y,
        ) > 0.5
      )
        this.moving = true;
    }
    for (const label of out) {
      const leaf = this.leaves.get(label.id);
      if (leaf) leaf.frame = label;
    }
    out = protectTideLeafVisibility(out, state, base);
    // Relation endpoints use the rendered poses, never jump ahead to target poses.
    const relations: ScenePrimitive[] = [];
    const rows =
      this.catalog.manifest?.chapters.filter(
        (row) => row.hub === state.focus,
      ) ?? [];
    const chapterLabels = new Map(
      out
        .filter((label) => label.id.startsWith(`${state.focus}:tide:chapter:`))
        .map((label) => [
          label.id.slice(`${state.focus}:tide:chapter:`.length),
          label,
        ]),
    );
    if (
      !state.overview &&
      state.viewport.width > 700 &&
      chapterLabels.size === rows.length
    ) {
      for (const row of rows)
        if (row.parent) {
          const from = chapterLabels.get(row.parent),
            to = chapterLabels.get(row.id);
          if (from && to)
            relations.push({
              type: "polyline",
              points: [from.layout.position, to.layout.position],
              stroke: hubInk(hub.theme, base.visualTheme),
              strokeWidth: 1,
              opacity:
                0.3 *
                (1 - hub.morph) *
                Math.min(from.opacity, to.opacity) *
                (from.page?.opacity ?? 1) *
                (to.page?.opacity ?? 1),
            });
        }
    }
    const hits = desired.hitRegions.filter(
      (hit) => !desired.labels.some((label) => label.id === hit.id),
    );
    for (const label of out) {
      const hit = labelHitRegion(label);
      if (hit) hits.push(hit);
    }
    return {
      ...desired,
      labels: out,
      hitRegions: hits,
      layers: desired.layers.map((layer) =>
        layer.id === "relations"
          ? {
              ...layer,
              primitives: [
                ...(base.layers.find((item) => item.id === "relations")
                  ?.primitives ?? []),
                ...relations,
              ],
            }
          : layer,
      ),
    };
  };
}
