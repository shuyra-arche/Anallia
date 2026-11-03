import type { Catalog } from "../content/catalog.ts";
import type { FieldState, Vec, Command } from "../core/types.ts";
import type { FieldAttachment } from "../core/attachments.ts";
import type {
  LabelFrame,
  SceneFrame,
  ScenePrimitive,
} from "../core/graphics.ts";
import { clamp, unwrapAngle } from "../core/math.ts";
import { pageTurnPose, readingEnvelope } from "../core/transitions.ts";
import { hubInk } from "../core/palette.ts";
import { evaluateHubCurve } from "../geometry/graphics.ts";
import { evaluateLabel, labelHitRegion } from "../geometry/labels.ts";
import {
  arcOffsetS,
  hubToScreen,
  material,
  nodeS,
  cameraPinnedToHubPoint,
  outwardNormal,
  readingBearing,
} from "../geometry/field.ts";
import { projectAttachment } from "../geometry/attachments.ts";
import { arrangeTideLabels, fitTideGlyph } from "./tide-label-layout.ts";
import { tideLocalWindow } from "./tide-local-window.ts";
import type { SymbolInteractionState } from "../rendering/semantic-feedback.ts";
export const tideLenses: Record<
  string,
  { circle: [string, string]; line: [string, string] }
> = {
  SHORE: {
    circle: ["同一片岸", "潮线、拾得物与回程彼此照见；贝壳藏在潮线的细节里。"],
    line: ["一次往返", "循潮线出发，近看贝壳，拾起遗留，最后回到岸边。"],
  },
  LIGHT: {
    circle: [
      "光的两面",
      "守灯人的夜与窗外的海并置：一个人在等待，一片海被看见。",
    ],
    line: ["抵达以后", "先抵达灯塔，再读一整夜的守候，最后站到窗边回看。"],
  },
  LETTER: {
    circle: ["寄与未寄", "写信与回信同时留在纸上；答案也可以照亮提问。"],
    line: ["信的旅程", "遇见信封，展开未寄的信，再给它一个回音。"],
  },
};

/** Edition-only, pure numeric projection. No separate navigation/camera state or DOM controls. */
export function projectTideFrame(
  frame: Readonly<SceneFrame>,
  state: Readonly<FieldState>,
  catalog: Catalog,
  feedback: ReadonlyMap<string, SymbolInteractionState> = new Map(),
): SceneFrame {
  if (state.loading) return frame as SceneFrame;
  // A morph has a known endpoint. Plan there, then the presentation owner moves
  // the same labels continuously; never switch to a temporary edge layout because
  // the intermediate Möbius circle becomes infinitely large.
  if (state.morphTurn) {
    const turn = state.morphTurn,
      source = state.hubs[state.focus];
    const target = { ...source, morph: turn.to, targetMorph: turn.to };
    const siblings = catalog.siblings(source.path.at(-1)!, state.searchResults);
    const along = nodeS(
      target,
      target.scroll,
      siblings.length,
      state.camera,
      state.viewport,
    );
    const normal = outwardNormal(target, along);
    const rotation = unwrapAngle(
      turn.startRotation,
      readingBearing(target) - (Math.atan2(normal.y, normal.x) * 180) / Math.PI,
    );
    const camera = cameraPinnedToHubPoint(
      target,
      material(target, along),
      turn.screenAnchor,
      state.camera,
      state.viewport,
      rotation,
    );
    state = { ...state, camera, hubs: { ...state.hubs, [target.id]: target } };
  }
  const hub = state.hubs[state.focus],
    current = catalog.get(hub.path.at(-1)!);
  const rows = (catalog.manifest?.chapters ?? []).filter(
    (row) => row.hub === hub.id,
  );
  let labels: LabelFrame[] = [];
  const primitives: ScenePrimitive[] = [];
  const add = (
    host: string,
    key: string,
    name: string,
    aria: string,
    at: Vec,
    hinge: Vec,
    command: Command,
    parameter: number,
    selected = false,
  ) => {
    const owner =
      command.type === "focus"
        ? command.hub
        : command.type === "navigate" && catalog.chapters.has(command.target)
          ? catalog.get(command.target).hub
          : host;
    const attachment: FieldAttachment = {
      id: key,
      glyph: name,
      aria,
      command,
      scope: "chapter",
      role: "local",
      side: "content",
      distance: 0,
      anchor: { id: key, hostHub: host, parameter },
      visual: selected ? "current" : "peer",
      opacity: 1,
    };
    const label = evaluateLabel({
      hubId: host,
      key,
      name,
      aria,
      at,
      anchor: hinge,
      command,
      degree: 0,
      zoom: 1,
      kind: selected ? "current" : "peer",
      alpha: 1,
      page: null,
      attachment,
      activity: 0,
      interaction: feedback.get(`${host}:${key}`),
    });
    label.color = {
      hub: owner,
      ink: hubInk(state.hubs[owner].theme, frame.visualTheme),
    };
    labels.push(label);
    return label;
  };
  if (state.overview) {
    for (const target of [hub]) {
      const curve = evaluateHubCurve(target, state.camera, state.viewport);
      const at =
        curve.kind === "circle"
          ? { x: curve.cx, y: curve.cy }
          : hubToScreen(
              target,
              material(target, 0),
              state.camera,
              state.viewport,
            );
      add(
        target.id,
        `tide:hub:${target.id}`,
        target.glyph,
        `进入${target.glyph}枢：${catalog.get(target.root).title}`,
        at,
        at,
        { type: "focus", hub: target.id },
        0,
        target.id === state.focus,
      );
    }
  } else {
    const siblingsAtAnchor = catalog.siblings(current.id, state.searchResults);
    // Keep the departing ordinary anchor while its neighbour travels along the
    // curve. Selecting only visual=current used to teleport the visible label.
    for (const ordinary of frame.labels.filter(
      (label) =>
        label.hubId === hub.id && label.attachment?.role === "ordinary",
    )) {
      const index = siblingsAtAnchor.findIndex(
        (row) => row.id === ordinary.attachment?.id,
      );
      const visibility = clamp(1 - Math.abs(index - hub.scroll), 0, 1);
      if (visibility <= 0.001) continue;
      const scale = Math.max(1, ordinary.layout.scale),
        { position, hinge } = ordinary.layout;
      labels.push({
        ...ordinary,
        opacity: ordinary.opacity * visibility,
        interactive: ordinary.interactive && visibility > 0.98,
        layout: {
          ...ordinary.layout,
          scale,
          offset: {
            x: (position.x - hinge.x) / scale,
            y: (position.y - hinge.y) / scale,
          },
        },
      });
    }
    {
      const curve = evaluateHubCurve(hub, state.camera, state.viewport);
      const circle = hub.targetMorph < 0.5;
      const completeCircle =
        curve.kind === "circle" &&
        curve.radius >= 160 &&
        curve.cx - curve.radius >= 8 &&
        curve.cx + curve.radius <= state.viewport.width - 8 &&
        curve.cy - curve.radius >= 110 &&
        curve.cy + curve.radius <= state.viewport.height - 12;
      const siblings = catalog.siblings(current.id, state.searchResults);
      const focus = nodeS(
        hub,
        hub.scroll,
        siblings.length,
        state.camera,
        state.viewport,
      );
      const selected = rows.findIndex((row) => row.id === current.id);
      const lineScore = (direction: number) =>
        rows.reduce((sum, _, i) => {
          const parameter = arcOffsetS(
            hub,
            focus,
            (direction * (i - selected) * 57) / state.camera.z,
          );
          const p = hubToScreen(
            hub,
            material(hub, parameter, -65 / state.camera.z),
            state.camera,
            state.viewport,
          );
          return (
            sum +
            Math.max(
              0,
              44 - p.x,
              p.x - state.viewport.width + 44,
              120 - p.y,
              p.y - state.viewport.height + 28,
            )
          );
        }, 0);
      const direction = lineScore(1) <= lineScore(-1) ? 1 : -1;
      const spatial =
        state.viewport.width > 700 &&
        rows.length <= 6 &&
        rows.every(
          (row) =>
            [...row.name].length <= 8 && catalog.chain(row.id).length <= 3,
        ) &&
        (circle ? completeCircle : lineScore(direction) === 0);
      if (spatial) {
        const positions = new Map<string, Vec>();
        rows.forEach((row, i) => {
          let at: Vec, hinge: Vec, parameter: number;
          if (circle && curve.kind === "circle") {
            const chain = catalog.chain(row.id);
            const branch = chain[1] ?? row.id;
            const branches = catalog.get(hub.root).children;
            const branchIndex = Math.max(0, branches.indexOf(branch));
            let angle =
              ((hub.angle + state.camera.rotation) * Math.PI) / 180 -
              Math.PI / 2 +
              (branchIndex * 2 * Math.PI) / Math.max(1, branches.length);
            const depth = chain.length - 1;
            if (depth > 1) {
              const family = catalog.get(row.parent!).children;
              angle +=
                (family.indexOf(row.id) - (family.length - 1) / 2) * 0.3 + 0.38;
            }
            const radius =
              curve.radius * (depth === 0 ? 0 : depth === 1 ? 0.46 : 0.73);
            at = {
              x: curve.cx + radius * Math.cos(angle),
              y: curve.cy + radius * Math.sin(angle),
            };
            hinge = at;
            parameter = angle;
          } else {
            parameter = arcOffsetS(
              hub,
              focus,
              (direction * (i - selected) * 57) / state.camera.z,
            );
            hinge = hubToScreen(
              hub,
              material(hub, parameter),
              state.camera,
              state.viewport,
            );
            at = hubToScreen(
              hub,
              material(
                hub,
                parameter,
                -(65 + Math.max(0, catalog.chain(row.id).length - 2) * 18) /
                  state.camera.z,
              ),
              state.camera,
              state.viewport,
            );
          }
          positions.set(row.id, at);
          add(
            hub.id,
            `tide:chapter:${row.id}`,
            circle ? row.name : `${i + 1} ${row.name}`,
            `${row.name} · ${row.title}${row.id === current.id ? " · 切换圆线形态" : " · 阅读"}`,
            at,
            hinge,
            row.id === current.id
              ? { type: "morph" }
              : { type: "navigate", target: row.id },
            parameter,
            row.id === current.id,
          );
        });
        if (circle)
          for (const row of rows)
            if (row.parent) {
              const from = positions.get(row.parent),
                to = positions.get(row.id);
              if (from && to)
                primitives.push({
                  type: "polyline",
                  points: [from, to],
                  stroke: hubInk(hub.theme, frame.visualTheme),
                  strokeWidth: 1,
                  opacity: 0.3,
                });
            }
      } else {
        const window = tideLocalWindow(state, catalog);
        const targets: {
          key: string;
          name: string;
          aria: string;
          command: Command;
          slot: number;
        }[] = window.visible.map((item, i) => ({
          key: `chapter:${item.target}`,
          name: `${item.prefix}${
            state.viewport.width <= 700 &&
            [...catalog.get(item.target).name].length > 2
              ? catalog
                  .siblings(item.target, state.searchResults)
                  .findIndex((row) => row.id === item.target) + 1
              : catalog.get(item.target).name
          }`,
          aria: `${item.title}：${catalog.get(item.target).name} · ${catalog.get(item.target).title}`,
          command: { type: "navigate", target: item.target },
          slot: item.prefix === "↑" ? -2 : item.prefix === "‹" ? -1 : i + 1,
        }));
        if (window.paged) {
          if (window.start > 0)
            targets.unshift({
              key: "window:before",
              name: "︿",
              aria: `较前的标签；当前第 ${window.start + 1} 至 ${window.start + window.count} 项，共 ${window.items.length} 项`,
              command: { type: "scroll-local", delta: -window.count },
              slot: -3,
            });
          if (window.start < window.maxScroll)
            targets.push({
              key: "window:after",
              name: "﹀",
              aria: `更多标签；当前第 ${window.start + 1} 至 ${window.start + window.count} 项，共 ${window.items.length} 项`,
              command: { type: "scroll-local", delta: window.count },
              slot: window.count + 2,
            });
        }
        for (const target of targets) {
          const parameter = arcOffsetS(
            hub,
            focus,
            (target.slot * 52) / state.camera.z,
          );
          const attachment: FieldAttachment = {
            id: target.key,
            glyph: target.name,
            aria: target.aria,
            command: target.command,
            scope: "chapter",
            role: "local",
            anchor: { id: `tide:${target.key}`, hostHub: hub.id, parameter },
            side: "content",
            distance: 48,
            opacity: 1,
            visual: "peer",
          };
          const projected = projectAttachment(
            hub,
            attachment,
            state.camera,
            state.viewport,
          );
          const label = add(
            hub.id,
            `tide:${target.key}`,
            target.name,
            target.aria +
              (window.paged ? "；可在标签上滚动或拖动，查看更多" : ""),
            projected.position,
            projected.hinge,
            target.command,
            parameter,
          );
          if (window.paged) label.localScrollHub = hub.id;
        }
      }
    }
  }
  const paper = frame.reading.find(
    (item) => item.visible && item.chapterId === current.id,
  );
  const compactWidth = paper
    ? Math.max(
        44,
        Math.min(
          76,
          Math.max(
            paper.left - 14,
            state.viewport.width - paper.left - paper.width - 14,
          ),
        ),
      )
    : 76;
  labels = arrangeTideLabels(
    labels
      .filter((label) => label.color?.hub === state.focus)
      .map((label) =>
        fitTideGlyph(
          state.viewport.width <= 700
            ? { ...label, layout: { ...label.layout, degree: 0 } }
            : label,
          state.viewport.width <= 700 ? compactWidth : 132,
        ),
      ),
    state,
    frame,
  );
  for (const label of labels)
    if (label.id.includes(":tide:chapter:")) {
      // Shared hierarchy clock swaps payload only on the hidden back of the page.
      if (state.contentTurn) {
        label.page = pageTurnPose(
          state.contentTurn.phase,
          state.settings.reducedMotion,
          state.contentTurn.direction,
        );
        label.interactive = label.page.interactive;
      }
      if (state.passage) {
        label.opacity *= readingEnvelope(state.passage.phase);
        label.interactive = false;
      }
    }
  const hits = frame.hitRegions
    .filter((hit) => !frame.labels.some((label) => label.id === hit.id))
    .map((hit) =>
      hit.graspKind === "hub"
        ? {
            ...hit,
            shape:
              hit.shape.type === "circle"
                ? {
                    ...hit.shape,
                    strokeWidth: Math.max(44, hit.shape.strokeWidth ?? 0),
                  }
                : hit.shape.type === "polyline"
                  ? {
                      ...hit.shape,
                      tolerance: Math.max(22, hit.shape.tolerance),
                    }
                  : hit.shape,
          }
        : hit,
    );
  for (const label of labels) {
    const hit = labelHitRegion(label);
    if (hit) hits.push(hit);
  }
  return {
    ...frame,
    labels,
    hitRegions: hits,
    layers: frame.layers.map((layer) =>
      layer.id === "relations"
        ? { ...layer, primitives: [...layer.primitives, ...primitives] }
        : layer.id === "hubs"
          ? {
              ...layer,
              primitives: layer.primitives.filter((p) => p.type !== "text"),
            }
          : layer,
    ),
  };
}
