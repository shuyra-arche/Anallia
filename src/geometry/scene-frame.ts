import type { Chapter, Command, FieldState, Hub, Vec } from "../core/types.ts";
import type { FieldAttachment } from "../core/attachments.ts";
import type {
  LabelFrame,
  PortalFrame,
  SceneFrame,
  SceneMask,
  ScenePrimitive,
  ResolvedRendererKind,
} from "../core/graphics.ts";
import { emptySceneFrame, sceneLayer } from "../core/graphics.ts";
import { readingEnvelope, pageTurnPose } from "../core/transitions.ts";
import type { PagePose } from "../core/transitions.ts";
import {
  PAPER,
  BOUNDARY,
  blendHex,
  needsColorSweep,
  isDarkTheme,
} from "../core/palette.ts";
import { evaluatePerception } from "../core/perception.ts";
import type { HubPerception } from "../core/perception.ts";
import { ease, clamp } from "../core/math.ts";
import { resolveSymbolKind } from "../core/symbol-morph.ts";
import type { SymbolKind } from "../core/symbol-morph.ts";
import type { Catalog } from "../content/catalog.ts";
import {
  globalAttachments,
  resolveGlobalHostHub,
} from "../application/attachments.ts";
import type { LocalLabelFrame } from "../core/graphics.ts";
import { projectAttachment } from "./attachments.ts";
import { material, nodeS, hubToScreen } from "./field.ts";
import {
  clipMaskShapes,
  curveToPrimitive,
  evaluateFilament,
  evaluateHubAuraCurve,
  evaluateHubCurve,
  evaluatePassageGeometry,
  evaluateRemotePortalGeometry,
} from "./graphics.ts";
import { evaluateLabel, labelHitRegion } from "./labels.ts";

export const TRADITIONAL_HUD_ZOOM_THRESHOLD = 0.45;
type Feedback = NonNullable<LabelFrame["interaction"]>;
export function symbolActivity(
  feedback: Feedback | undefined,
  kind: SymbolKind,
  s?: FieldState | null,
): number {
  const semanticActive =
    feedback?.active ||
    Boolean(
      s &&
      ((kind === "overview" && s.overview) ||
        (kind === "search" && !s.overview && s.focus === "Q") ||
        (kind === "settings" && !s.overview && s.focus === "S")),
    );
  let activity = semanticActive ? 0.35 : 0;
  if (feedback?.hover || feedback?.focus) activity = Math.max(activity, 0.62);
  if (feedback?.press) activity = 1;
  return clamp(activity, 0, 1);
}

export interface SceneFrameInput {
  renderer: ResolvedRendererKind;
  revision: number;
  relationColor: string;
  focusedEntries: readonly FieldAttachment[];
  locals: readonly LocalLabelFrame[];
  feedback: ReadonlyMap<string, Feedback>;
  hoveredTarget: string | null;
}

/** Pure numeric scene computation; the host supplies layout and semantic feedback snapshots. */
export function buildSceneFrame(
  s: FieldState,
  catalog: Catalog,
  options: SceneFrameInput,
): {
  frame: SceneFrame;
  perception: ReturnType<typeof evaluatePerception>;
  useTraditionalHud: boolean;
} {
  const frame = emptySceneFrame(
    options.renderer,
    s.viewport,
    s.camera,
    s.theme,
  );
  frame.revision = options.revision;
  const { focusedEntries, locals } = options;
  const selected = (hub: Hub) => catalog.get(hub.path.at(-1)!);
  const perception = evaluatePerception(s, catalog, options.hoveredTarget);
  const label = (
    hub: Hub,
    key: string,
    name: string,
    at: Vec,
    anchor: Vec,
    kind: string,
    degree: number,
    command: Command,
    aria = name,
    alpha = 1,
    page: PagePose | null = null,
    attachment?: FieldAttachment,
    state?: FieldState,
  ) => {
    const feedback = options.feedback.get(`${hub.id}:${key}`);
    if (
      alpha >= 0.999 &&
      attachment?.role === "operation" &&
      perception.stage === "threshold" &&
      !feedback?.hover &&
      !feedback?.focus
    )
      alpha = 0.42;
    const symbolKind =
      attachment?.symbolKind ??
      (attachment?.scope === "global" ? resolveSymbolKind(name) : undefined);
    const item = evaluateLabel({
      hubId: hub.id,
      key,
      name,
      at,
      anchor,
      kind,
      degree,
      command,
      aria,
      alpha,
      page,
      attachment,
      zoom: state?.camera.z ?? 1,
      interaction: feedback,
      activity: symbolKind ? symbolActivity(feedback, symbolKind, state) : 0,
    });
    frame.labels.push(item);
    const hit = labelHitRegion(item);
    if (hit) frame.hitRegions.push(hit);
  };
  const contentTurn = s.contentTurn;
  const turnPose = contentTurn
    ? pageTurnPose(
        contentTurn.phase,
        s.settings.reducedMotion,
        contentTurn.direction,
      )
    : null;
  const chapterEnvelope = s.passage ? readingEnvelope(s.passage.phase) : 1;

  const visualThemeForField =
    s.passage && s.passage.phase >= 0.5 ? s.passage.theme : s.theme;
  frame.visualTheme = visualThemeForField;
  const relationColor = options.relationColor;
  const relationOpacity = s.loading
    ? 0
    : perception.resonatingHubId
      ? 0.46
      : s.overview
        ? 0.34
        : 0.22;
  const darkPalette = isDarkTheme(visualThemeForField);
  const hubPrimitives: ScenePrimitive[] = [];
  const relationPrimitives: ScenePrimitive[] = [];
  const focusHubObj = s.hubs[perception.focusedHubId] ?? s.hubs[s.focus];
  const focusSibs = catalog.siblings(selected(focusHubObj).id, s.searchResults);
  const focusAnchorScreen = hubToScreen(
    focusHubObj,
    material(
      focusHubObj,
      nodeS(
        focusHubObj,
        focusHubObj.scroll,
        focusSibs.length,
        s.camera,
        s.viewport,
      ),
      0,
    ),
    s.camera,
    s.viewport,
  );

  for (const h of Object.values(s.hubs)) {
    const active = h.id === s.focus && !s.overview && !s.loading,
      hubPerception = perception.hubs[h.id],
      sig = hubPerception.signature;
    const strokeColor = darkPalette ? sig.darkStroke : sig.lightStroke;
    const curve = evaluateHubCurve(h, s.camera, s.viewport);
    hubPrimitives.push(
      curveToPrimitive(curve, {
        stroke: hubPerception.tier === "resonating" ? sig.accentColor : strokeColor,
        strokeWidth: 1.25 * hubPerception.strokeWidthScale * s.camera.z,
        opacity: hubPerception.curveOpacity,
        dash:
          !active && sig.curveDash && hubPerception.tier !== "resonating"
            ? sig.curveDash.split(/\s+/).map(Number)
            : undefined,
      }),
    );
    frame.hitRegions.push({
      id: `hub:${h.id}`,
      command: active ? { type: "morph" } : { type: "focus", hub: h.id },
      hubId: h.id,
      graspKind: "hub",
      shape:
        curve.kind === "circle"
          ? {
              type: "circle",
              x: curve.cx,
              y: curve.cy,
              radius: curve.radius,
              strokeWidth: 32 * s.camera.z,
            }
          : {
              type: "polyline",
              points: curve.points,
              tolerance: 16 * s.camera.z,
            },
      priority: 10,
    });

    const auraCurve =
      hubPerception.auraOpacity > 0.01
        ? evaluateHubAuraCurve(h, s.camera, s.viewport, sig.auraOffset)
        : null;
    if (auraCurve) {
      hubPrimitives.push(
        curveToPrimitive(auraCurve, {
          stroke:
            hubPerception.tier === "resonating" ? sig.accentColor : strokeColor,
          strokeWidth: 0.9 * s.camera.z,
          opacity: hubPerception.auraOpacity,
          dash: sig.auraDash
            ? sig.auraDash.split(/\s+/).map(Number)
            : undefined,
        }),
      );
    }

    const current = selected(h);
    const nodes = catalog.siblings(current.id, s.searchResults);
    appendTraces(h, nodes, s, hubPerception, darkPalette, hubPrimitives, PAPER[visualThemeForField]);

    if (
      !s.loading &&
      h.id !== focusHubObj.id &&
      (hubPerception.tier === "resonating" || hubPerception.tier === "related")
    ) {
      const targetParam = nodeS(
        h,
        h.scroll,
        nodes.length,
        s.camera,
        s.viewport,
      );
      const targetScreen = hubToScreen(
        h,
        material(h, targetParam, 0),
        s.camera,
        s.viewport,
      );
      if (
        Number.isFinite(
          focusAnchorScreen.x +
            focusAnchorScreen.y +
            targetScreen.x +
            targetScreen.y,
        )
      ) {
        relationPrimitives.push({
          type: "polyline",
          points: evaluateFilament(focusAnchorScreen, targetScreen),
          stroke: relationColor,
          strokeWidth: 0.9 * s.camera.z,
          opacity: relationOpacity,
          dash: [4, 6],
        });
      }
    }

    if (s.loading || !active) continue;

    const materialSide: 1 | -1 = 1;
    for (const attachment of focusedEntries) {
      if (attachment.role === "local") continue;
      const point = projectAttachment(
        h,
        attachment,
        s.camera,
        s.viewport,
        materialSide,
      );
      label(
        h,
        attachment.id,
        attachment.glyph,
        point.position,
        point.hinge,
        attachment.visual,
        point.degree,
        attachment.command,
        attachment.aria,
        attachment.opacity * chapterEnvelope,
        contentTurn?.hub === h.id ? turnPose : null,
        attachment,
        s,
      );
    }
  }

  frame.layers.push(
    sceneLayer("hubs", 30, hubPrimitives),
    sceneLayer("relations", 40, relationPrimitives),
  );

  for (const leaf of locals) {
    const attachment = leaf.attachment;
    const hub = s.hubs[attachment.anchor.hostHub];
    const point = projectAttachment(hub, attachment, s.camera, s.viewport, 1);
    label(
      hub,
      attachment.anchor.id,
      attachment.glyph,
      point.position,
      point.hinge,
      attachment.visual,
      point.degree,
      attachment.command,
      attachment.aria,
      attachment.opacity,
      leaf.pose,
      attachment,
      s,
    );
    frame.labels[frame.labels.length - 1].localPhase = leaf.phase;
    const isResonatingRef =
      attachment.command.type === "navigate" &&
      (attachment.command.target === perception.resonatingTargetId ||
        (perception.resonatingHubId !== null &&
          catalog.chapters.get(attachment.command.target)?.hub ===
            perception.resonatingHubId));
    frame.labels[frame.labels.length - 1].resonating = isResonatingRef;
  }

  const useTraditionalHud =
    s.overview || s.camera.z < TRADITIONAL_HUD_ZOOM_THRESHOLD;

  if (!s.loading && !useTraditionalHud) {
    const owner = resolveGlobalHostHub(s);
    const materialSide: 1 | -1 = 1;
    for (const attachment of globalAttachments(s, catalog)) {
      const point = projectAttachment(
        owner,
        attachment,
        s.camera,
        s.viewport,
        materialSide,
      );
      // Global operation labels do NOT animate or fade during hub-switching passage.
      label(
        owner,
        attachment.id,
        attachment.glyph,
        point.position,
        point.hinge,
        attachment.visual,
        point.degree,
        attachment.command,
        attachment.aria,
        attachment.opacity,
        null,
        attachment,
        s,
      );
    }
  }
  const t = s.passage;
  const bgMix = t ? ease(clamp((t.phase - 0.42) / 0.58, 0, 1)) : 1;
  const baseFill = t
    ? blendHex(PAPER[t.sourceTheme], PAPER[t.theme], bgMix)
    : PAPER[s.theme];
  frame.layers.unshift(
    sceneLayer("base", 0, [
      {
        type: "rect",
        x: 0,
        y: 0,
        width: s.viewport.width,
        height: s.viewport.height,
        fill: baseFill,
      },
    ]),
  );
  if (t && needsColorSweep(t.sourceTheme, t.theme)) {
    const geometry = evaluatePassageGeometry(t, s.camera, s.viewport);
    const portalAlpha =
      ease(clamp(t.phase / 0.12, 0, 1)) *
      ease(clamp((1 - t.phase) / 0.12, 0, 1));
    let echoGeometry: ReturnType<typeof evaluateRemotePortalGeometry> | null =
      null;
    if (t.kind === "remote" || t.kind === "axis") {
      echoGeometry = evaluateRemotePortalGeometry(
        clamp(t.phase - 0.055, 0, 1),
        s.viewport,
      );
    }
    const mask: SceneMask = {
      id: "portal",
      visible: true,
      opacity: portalAlpha,
      rule: geometry.boundary.rule,
      shapes: clipMaskShapes(geometry.boundary),
      outerRect: geometry.boundary.outerRect,
      fill: PAPER[t.theme],
    };
    frame.masks.push(mask);
    const portalFrame: PortalFrame = {
      visible: true,
      opacity: portalAlpha,
      fill: PAPER[t.theme],
      maskId: mask.id,
      stroke: {
        path: geometry.stroke,
        color: BOUNDARY[t.theme],
        opacity: Math.sin(t.phase * Math.PI) * 0.82,
        width: 2.3 * s.camera.z,
      },
      echo:
        echoGeometry && (t.kind === "remote" || t.kind === "axis")
          ? {
              path: echoGeometry.stroke,
              color: BOUNDARY[t.sourceTheme],
              opacity: Math.sin(t.phase * Math.PI) * 0.26,
              width: 1.2 * s.camera.z,
              dash: [4 * s.camera.z, 4 * s.camera.z],
            }
          : undefined,
    };
    frame.portal = portalFrame;
  } else {
    frame.portal = null;
  }
  frame.layers.push(
    sceneLayer("portal", 10),
    sceneLayer("background", 20),
    sceneLayer("labels", 50),
    sceneLayer("reading", 60),
  );
  frame.layers.sort((a, b) => a.order - b.order);
  return { frame, perception, useTraditionalHud };
}

function appendTraces(
  h: Hub,
  nodes: Chapter[],
  s: FieldState,
  perception: HubPerception | undefined,
  darkPalette: boolean,
  primitives: ScenePrimitive[],
  paper: string,
): void {
  if (s.loading || (h.id === s.focus && !s.overview)) return;
  const sig = perception?.signature,
    tickScale = sig?.tickScale ?? 1;
  const strokeColor = sig
    ? darkPalette
      ? sig.darkStroke
      : sig.lightStroke
    : "";
  const markers: ScenePrimitive[] = [];
  const activeIdx =
    ((Math.round(h.scroll) % nodes.length) + nodes.length) % nodes.length;
  for (let j = 0; j < nodes.length; j++) {
    const param = nodeS(h, j, nodes.length, s.camera, s.viewport);
    const p0 = hubToScreen(h, material(h, param, 0), s.camera, s.viewport);
    const isSelected = j === activeIdx;
    const baseLen = (isSelected ? -26 : j % 2 === 0 ? -16 : -11) * tickScale;
    const p1 = hubToScreen(
      h,
      material(h, param, baseLen),
      s.camera,
      s.viewport,
    );
    primitives.push({
      type: "polyline",
      points: [p0, p1],
      stroke: strokeColor,
      strokeWidth: 0.9 * s.camera.z,
      opacity: perception?.traceOpacity ?? 0.2,
    });
    if (
      sig &&
      (sig.archetype === "origin" ||
        sig.archetype === "portal" ||
        sig.archetype === "instrument")
    ) {
      const pOut = hubToScreen(
        h,
        material(h, param, isSelected ? 9 : 4.5),
        s.camera,
        s.viewport,
      );
      primitives.push({
        type: "polyline",
        points: [p0, pOut],
        stroke: strokeColor,
        strokeWidth: 0.75 * s.camera.z,
        opacity: perception?.traceOpacity ?? 0.2,
      });
    }
    if (!isSelected) continue;
    const dot = hubToScreen(
      h,
      material(h, param, baseLen - 5.5),
      s.camera,
      s.viewport,
    );
    markers.push({
      type: "circle",
      cx: dot.x,
      cy: dot.y,
      radius: 2.4 * (perception?.dotScale ?? 1) * s.camera.z,
      fill: sig?.accentColor ?? strokeColor,
      opacity: perception?.traceOpacity ?? 0.2,
    });
    if (perception && perception.beaconOpacity > 0.05) {
      const at = hubToScreen(
        h,
        material(h, param, baseLen - 22),
        s.camera,
        s.viewport,
      );
      const fontSize =
        perception.tier === "resonating"
          ? 16.5
          : perception.tier === "related"
            ? 14.5
            : 12;
      markers.push({
        type: "text",
        x: at.x,
        y: at.y,
        text: h.glyph,
        fontSize,
        fontWeight: 620,
        fontFamily: "var(--font-symbol)",
        stroke: paper,
        strokeWidth: 3.5,
        strokeScale: "screen",
        scale: Math.max(0.55, s.camera.z),
        fill:
          perception.tier === "resonating" && sig
            ? sig.accentColor
            : strokeColor,
        align: "center",
        baseline: "middle",
        opacity: perception.beaconOpacity,
      });
    }
  }
  primitives.push(...markers);
}
