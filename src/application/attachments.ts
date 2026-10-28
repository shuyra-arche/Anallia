import type {
  Camera,
  Chapter,
  FieldState,
  Hub,
  Viewport,
} from "../core/types.ts";
import type { FieldAttachment } from "../core/attachments.ts";
import {
  GLOBAL_OPERATIONS,
  resolveGlobalCommand,
} from "../core/attachments.ts";
import { classifyLabelContent, resolveIconToken } from "../core/icons.ts";
import { evaluateSymbol, symbolMorphFromHub } from "../core/symbol-morph.ts";
import { planLocalBand, localVisible } from "../core/local-nav.ts";
import type { LocalBand } from "../core/local-nav.ts";
import { arcLengthAt, arcOffsetS, nodeS } from "../geometry/field.ts";
import { clamp } from "../core/math.ts";
import { Catalog } from "../content/catalog.ts";

/**
 * Hierarchical radial normal distances (in constant screen pixels):
 * - Current focused ordinary chapter label: 48px (longest primary stem)
 * - Peer ordinary chapter labels: 34px (medium primary stem)
 * - Local extension labels (`↑` and `refs`): 22px (short secondary stem)
 * - Opposite global operation labels: 52px on the opposite normal side
 */
export const STEM_DISTANCE = {
  currentOrdinary: 48,
  peerOrdinary: 34,
  localExtension: 22,
  globalOperation: 52,
} as const;

/**
 * Unified Label & Relationship-Driven Placement:
 * - Appending `local` extension labels (`↑` and `current.refs`) next to the focused ordinary label
 *   automatically pushes apart neighboring `ordinary` labels by `localSpreadArc`,
 *   preventing cross-level crowding while keeping each ordinary anchor's identity stable.
 * - Radial stem distances are stratified by hierarchy level (`48px` current, `34px` peer, `22px` local).
 */
export function ordinaryAndLocalAttachments(
  hub: Hub,
  current: Chapter,
  nodes: readonly Chapter[],
  camera: Camera,
  viewport: Viewport,
): FieldAttachment[] {
  const focusIndex = Math.max(
    0,
    nodes.findIndex((node) => node.id === current.id),
  );
  const focus = nodeS(hub, hub.scroll, nodes.length, camera, viewport);
  const items: {
    glyph: string;
    aria: string;
    command: FieldAttachment["command"];
  }[] = [];
  if (current.parent)
    items.push({ glyph: "↑", aria: "返回上一级", command: { type: "up" } });
  for (const ref of current.refs)
    items.push({
      glyph: ref.glyph,
      aria: `前往 ${ref.glyph}`,
      command: { type: "navigate", target: ref.target },
    });

  const band = localBandForHub(
    hub,
    current,
    nodes,
    camera,
    viewport,
    items.length,
  );
  const scroll = clamp(hub.localScroll, 0, band.maxScroll);
  const local: FieldAttachment[] = [];
  items.forEach((item, index) => {
    const slot = localVisible(index, scroll, band);
    if (!slot) return;
    local.push({
      id: `local:${index}`,
      glyph: item.glyph,
      aria: item.aria,
      scope: "hub",
      role: "local",
      side: "content",
      distance: STEM_DISTANCE.localExtension,
      anchor: {
        id: `local:${current.id}:${index}`,
        hostHub: hub.id,
        parameter: arcOffsetS(hub, focus, slot.arc),
      },
      command: item.command,
      visual: "nav",
      opacity: slot.opacity,
      contentKind: classifyLabelContent(item.glyph),
      icon: resolveIconToken(item.glyph),
    });
  });

  // Appended local labels widen the arc distance to neighboring ordinary labels
  const visibleLocalCount = local.length;
  const spreadMagnitude = visibleLocalCount * band.step;

  const windowed = nodes.length > 6;
  const ordinary: FieldAttachment[] = [];
  nodes.forEach((chapter, index) => {
    const dist = Math.abs(index - hub.scroll);
    if (windowed && dist > 3.6 && !(hub.layout === "anchored" && index === 0))
      return;
    const selected = chapter.id === current.id;
    const baseParam = nodeS(hub, index, nodes.length, camera, viewport);
    let deltaArc = 0;
    if (visibleLocalCount > 0 && index !== focusIndex) {
      if ((index - focusIndex) * band.direction > 0) {
        deltaArc = band.direction * spreadMagnitude;
      } else if (focusIndex === 0 && band.direction === -1 && index > 0) {
        deltaArc = spreadMagnitude * 0.65;
      } else if (
        focusIndex === nodes.length - 1 &&
        band.direction === 1 &&
        index < focusIndex
      ) {
        deltaArc = -spreadMagnitude * 0.65;
      }
    }
    const parameter =
      deltaArc !== 0 ? arcOffsetS(hub, baseParam, deltaArc) : baseParam;
    ordinary.push({
      id: chapter.id,
      glyph: chapter.name,
      aria: `${chapter.name} · ${chapter.title}${selected ? " · 切换圆线形态" : ""}`,
      role: "ordinary",
      scope: "chapter",
      side: "content",
      distance: selected
        ? STEM_DISTANCE.currentOrdinary
        : STEM_DISTANCE.peerOrdinary,
      anchor: {
        id: `chapter:${chapter.id}`,
        hostHub: hub.id,
        parameter,
      },
      visual: selected ? "current" : "peer",
      opacity: windowed ? clamp((3.8 - dist) / 1.1, 0.25, 1) : 1,
      command: selected
        ? { type: "morph" }
        : { type: "navigate", target: chapter.id },
      contentKind: classifyLabelContent(chapter.name),
      icon: resolveIconToken(chapter.name),
    });
  });

  return [...ordinary, ...local];
}

/** Compute local scrolling capacity using the settled scrollTarget index so
 * mid-scroll interpolation never zeroes out the gap or flips direction. */
export function localBandForHub(
  hub: Hub,
  current: Chapter,
  nodes: readonly Chapter[],
  camera: Camera,
  viewport: Viewport,
  count: number = (current.parent ? 1 : 0) + current.refs.length,
): LocalBand {
  const index = Math.max(
    0,
    nodes.findIndex((node) => node.id === current.id),
  );
  const settledHub = { ...hub, scroll: index };
  const focus = nodeS(settledHub, index, nodes.length, camera, viewport);
  const before =
    index > 0
      ? Math.abs(
          arcLengthAt(
            settledHub,
            nodeS(settledHub, index - 1, nodes.length, camera, viewport),
          ) - arcLengthAt(settledHub, focus),
        )
      : null;
  const after =
    index + 1 < nodes.length
      ? Math.abs(
          arcLengthAt(
            settledHub,
            nodeS(settledHub, index + 1, nodes.length, camera, viewport),
          ) - arcLengthAt(settledHub, focus),
        )
      : null;
  return planLocalBand(before, after, count, hub.localDirection);
}

/**
 * When switching hubs (`state.passage`), global operations immediately bind to the destination
 * hub without playing a cross-hub transition animation.
 */
export function resolveGlobalHostHub(state: FieldState): Hub {
  if (state.passage) {
    return state.hubs[state.passage.target] ?? state.hubs[state.focus];
  }
  const focusHub = state.hubs[state.focus];
  if (!state.overview) return focusHub;
  const focusDist = Math.hypot(
    state.camera.x - focusHub.center.x,
    state.camera.y - focusHub.center.y,
  );
  if (focusDist <= 950) return focusHub;
  let nearest = focusHub;
  let best = focusDist;
  for (const candidate of Object.values(state.hubs)) {
    const d = Math.hypot(
      state.camera.x - candidate.center.x,
      state.camera.y - candidate.center.y,
    );
    if (d < best) {
      best = d;
      nearest = candidate;
    }
  }
  return nearest;
}

/**
 * Opposite Operations (`role: "operation"`):
 * Global controls attach to the opposite material-normal side (`side: "opposite"`, `distance: 52`)
 * of the host hub. When switching hubs, global symbols immediately use the target hub's settled
 * morph state without cross-hub morph animation; they only animate during a single-hub `morphTurn`.
 */
export function globalAttachments(
  state: FieldState,
  catalog: Catalog,
): FieldAttachment[] {
  const hub = resolveGlobalHostHub(state);
  const effectiveMorph =
    state.morphTurn && state.morphTurn.hub === hub.id
      ? hub.morph
      : hub.targetMorph;
  const symMorph = symbolMorphFromHub({ morph: effectiveMorph });
  const current = catalog.get(hub.path.at(-1)!);
  const nodes = catalog.siblings(current.id, state.searchResults);
  const focus = nodeS(
    hub,
    hub.scroll,
    nodes.length,
    state.camera,
    state.viewport,
  );
  const roots = new Map(
    catalog.definitions.map((def) => [def.glyph, def.root]),
  );
  const operations: FieldAttachment[] = GLOBAL_OPERATIONS.map((op) => {
    const activeState =
      (op.symbolKind === "overview" && state.overview) ||
      (op.symbolKind === "search" && !state.overview && state.focus === "Q") ||
      (op.symbolKind === "settings" && !state.overview && state.focus === "S")
        ? 0.35
        : 0;
    return {
      id: `global:${op.id}`,
      glyph: op.glyph,
      aria: op.aria,
      role: "operation" as const,
      scope: "global" as const,
      side: "opposite" as const,
      distance: STEM_DISTANCE.globalOperation,
      anchor: {
        id: `operation:${op.id}`,
        hostHub: hub.id,
        parameter: arcOffsetS(hub, focus, op.arc),
      },
      visual: "nav" as const,
      opacity: op.id === "back" && state.history.length === 0 ? 0.38 : 1,
      command: resolveGlobalCommand(op, roots),
      contentKind: classifyLabelContent(op.glyph),
      icon: resolveIconToken(op.glyph),
      symbolKind: op.symbolKind,
      symbolMorph: op.symbolKind ? symMorph : undefined,
      symbolGeometry: op.symbolKind
        ? evaluateSymbol(op.symbolKind, symMorph, activeState)
        : undefined,
    };
  });
  if (state.overview) {
    operations.push({
      id: "global:refocus",
      glyph: "⌖",
      aria: "回到当前焦点",
      role: "operation",
      scope: "global",
      side: "opposite",
      distance: STEM_DISTANCE.globalOperation,
      anchor: {
        id: "operation:refocus",
        hostHub: hub.id,
        parameter: arcOffsetS(hub, focus, 144),
      },
      visual: "nav",
      opacity: 1,
      command: { type: "focus", hub: state.focus },
      contentKind: classifyLabelContent("⌖"),
      icon: resolveIconToken("⌖"),
    });
  }
  return operations;
}
