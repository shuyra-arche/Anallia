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
import { planLocalBand, localVisible } from "../core/local-nav.ts";
import type { LocalBand } from "../core/local-nav.ts";
import { arcLengthAt, arcOffsetS, nodeS } from "../geometry/field.ts";
import { clamp, ease } from "../core/math.ts";
import { Catalog } from "../content/catalog.ts";

/**
 * Hierarchical radial normal distances (in local world units):
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

/** Ordinary material anchors are independent of local-label visibility.
 * Local entries use the available following gap and scroll within it. */
export function ordinaryAndLocalAttachments(
  hub: Hub,
  current: Chapter,
  nodes: readonly Chapter[],
  camera: Camera,
  viewport: Viewport,
): FieldAttachment[] {
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

  const windowed = nodes.length > 6;
  const ordinary: FieldAttachment[] = [];
  nodes.forEach((chapter, index) => {
    const dist = Math.abs(index - hub.scroll);
    if (windowed && dist > 3.6 && !(hub.layout === "anchored" && index === 0))
      return;
    const selected = chapter.id === current.id;
    const parameter = nodeS(hub, index, nodes.length, camera, viewport);
    ordinary.push({
      id: chapter.id,
      glyph: chapter.name,
      aria: `${chapter.name} · ${chapter.title}${selected ? " · 切换圆线形态" : ""}`,
      role: "ordinary",
      scope: "chapter",
      side: "content",
      distance:
        STEM_DISTANCE.peerOrdinary +
        (STEM_DISTANCE.currentOrdinary - STEM_DISTANCE.peerOrdinary) *
          ease(clamp(1 - dist, 0, 1)),
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
  const after =
    index + 1 < nodes.length
      ? Math.abs(
          arcLengthAt(
            settledHub,
            nodeS(settledHub, index + 1, nodes.length, camera, viewport),
          ) - arcLengthAt(settledHub, focus),
        )
      : null;
  return planLocalBand(after, count);
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
 * of the host hub. Their selected icon geometry is static; only the host projection and
 * interaction colors change.
 */
export function globalAttachments(
  state: FieldState,
  catalog: Catalog,
): FieldAttachment[] {
  const hub = resolveGlobalHostHub(state);
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
