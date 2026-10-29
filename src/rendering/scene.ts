import type { LoadingGeometry } from "../geometry/loading.ts";
import { loadingShapes } from "../geometry/loading.ts";
import { renderLoadingGeometry, loadingToneColor } from "./loading.ts";
import { ArticleRenderer } from "./article.ts";
import { LocalLabelTurns } from "./local-labels.ts";
import {
  placeReading,
  readingHeight,
  readingWidth,
  resolveReadingClip,
} from "../core/layout.ts";
import { frameRateFromAction } from "../core/frame-rate.ts";
import { backgroundFromAction } from "../core/background.ts";
import { evaluatePerception } from "../core/perception.ts";
import type { HubPerception } from "../core/perception.ts";
import type {
  Chapter,
  Command,
  FieldState,
  Hub,
  Settings,
  Theme,
  Vec,
} from "../core/types.ts";
import { ease, clamp, rot } from "../core/math.ts";
import {
  readingEnvelope,
  morphReadingEnvelope,
  pageTurnPose,
} from "../core/transitions.ts";
import type { PagePose } from "../core/transitions.ts";
import { PAPER, BOUNDARY, blendHex, needsColorSweep, isDarkTheme, themeFromAction } from "../core/palette.ts";
import {
  ICON_TOKENS,
  classifyLabelContent,
  resolveIconToken,
} from "../core/icons.ts";
import type { IconToken } from "../core/icons.ts";
import { resolveSymbolKind } from "../core/symbol-morph.ts";
import type { SymbolGeometry, SymbolKind } from "../core/symbol-morph.ts";
import { Catalog } from "../content/catalog.ts";
import {
  ordinaryAndLocalAttachments,
  globalAttachments,
  resolveGlobalHostHub,
} from "../application/attachments.ts";
import { projectAttachment } from "../geometry/attachments.ts";
import type { FieldAttachment } from "../core/attachments.ts";
import {
  computeHubVerticalClearance,
  material,
  outwardNormal,
  nodeS,
  hubToScreen,
} from "../geometry/field.ts";
import { NS, svg, requireElement } from "./dom.ts";
import type {
  BackgroundFrame,
  GraphicsOptions,
  HitRegion,
  LabelFrame,
  PortalFrame,
  ResolvedRendererKind,
  SceneFrame,
  SceneMask,
  ScenePrimitive,
} from "../core/graphics.ts";
import {
  emptySceneFrame,
  hitTestFrame,
  sceneLayer,
} from "../core/graphics.ts";
import {
  clipMaskShapes,
  clipToSvgPath,
  curveToPrimitive,
  curveToSvgPath,
  evaluateFilament,
  evaluateHubAuraCurve,
  evaluateHubCurve,
  evaluatePassageGeometry,
  evaluateRemotePortalGeometry,
} from "../geometry/graphics.ts";
import { evaluateBackgroundFrame } from "./graphics/background.ts";
import { PixiGraphicsRenderer } from "./graphics/pixi-renderer.ts";

/** Camera zoom threshold below which focused hub global tags yield to the traditional HUD bar. */
export const TRADITIONAL_HUD_ZOOM_THRESHOLD = 0.45;

interface Label {
  group: SVGGElement;
  leaf: SVGGElement;
  pin: SVGCircleElement;
  stem: SVGPathElement;
  ring: SVGCircleElement;
  icon: SVGSVGElement;
  iconGlyph: SVGGElement;
  text: SVGTextElement;
  hit: SVGRectElement;
  renderedIconId?: string;
  renderedSymbolSignature?: string;
  symbolPaths?: Map<string, SVGPathElement>;
  symbolPoints?: Map<string, SVGCircleElement>;
}

export interface SymbolInteractionState {
  hover: boolean;
  focus: boolean;
  press: boolean;
  active: boolean;
}

function populateIconGlyph(target: SVGGElement, token: IconToken) {
  target.replaceChildren();
  const strokeWidth = (
    token.baseStrokeWidth + token.strokeCompensation
  ).toFixed(2);
  const dx = (-12 + token.opticalOffset.x).toFixed(2);
  const dy = (-12 + token.opticalOffset.y).toFixed(2);
  target.setAttribute(
    "transform",
    `translate(12 12) scale(${token.opticalScale}) translate(${dx} ${dy})`,
  );
  target.setAttribute("stroke-width", strokeWidth);
  for (const shape of token.shapes) {
    svg(shape.tag, target, shape.attrs);
  }
}

/**
 * Render or update a dynamic SymbolGeometry in-place inside `target` (<g class="label-icon-glyph">),
 * preserving existing <path> and <circle> DOM nodes across all intermediate morph frames m ∈ [0, 1].
 */
export function renderSymbolGeometryToGroup(
  target: SVGGElement,
  geom: SymbolGeometry,
  pathCache?: Map<string, SVGPathElement>,
  pointCache?: Map<string, SVGCircleElement>,
) {
  const { optical } = geom;
  const baseStroke = optical.baseStrokeWidth + optical.strokeCompensation;
  const dx = (-12 + optical.opticalOffset.x).toFixed(2);
  const dy = (-12 + optical.opticalOffset.y).toFixed(2);
  target.setAttribute(
    "transform",
    `translate(12 12) scale(${optical.opticalScale}) translate(${dx} ${dy})`,
  );
  target.setAttribute("stroke-width", baseStroke.toFixed(2));
  target.dataset.symbolKind = geom.kind;
  target.dataset.symbolMorph = geom.morph.toFixed(4);
  target.dataset.symbolActivity = geom.activity.toFixed(3);

  const canReuse =
    pathCache &&
    pointCache &&
    pathCache.size === geom.paths.length &&
    pointCache.size === geom.points.length &&
    geom.paths.every((p) => pathCache.has(p.id)) &&
    geom.points.every((pt) => pointCache.has(pt.id));

  if (!canReuse) {
    target.replaceChildren();
    pathCache?.clear();
    pointCache?.clear();
    for (const p of geom.paths) {
      const el = svg("path", target, {
        class: `symbol-path is-${p.role}`,
        "data-part-id": p.id,
        d: p.d,
        fill: "none",
      });
      if (p.strokeScale !== undefined) {
        el.setAttribute(
          "stroke-width",
          (baseStroke * p.strokeScale).toFixed(2),
        );
      }
      if (p.opacity !== undefined) {
        el.setAttribute("opacity", p.opacity.toFixed(3));
      }
      pathCache?.set(p.id, el);
    }
    for (const pt of geom.points) {
      const el = svg("circle", target, {
        class: `symbol-point is-${pt.role}`,
        "data-part-id": pt.id,
        cx: pt.x.toFixed(3),
        cy: pt.y.toFixed(3),
        r: pt.r.toFixed(3),
        fill: pt.filled !== false ? "currentColor" : "none",
        stroke: pt.filled !== false ? "none" : "currentColor",
      });
      if (pt.opacity !== undefined) {
        el.setAttribute("opacity", pt.opacity.toFixed(3));
      }
      pointCache?.set(pt.id, el);
    }
    return;
  }

  for (const p of geom.paths) {
    const el = pathCache!.get(p.id)!;
    el.setAttribute("d", p.d);
    if (p.strokeScale !== undefined) {
      el.setAttribute("stroke-width", (baseStroke * p.strokeScale).toFixed(2));
    }
  }
  for (const pt of geom.points) {
    const el = pointCache!.get(pt.id)!;
    el.setAttribute("cx", pt.x.toFixed(3));
    el.setAttribute("cy", pt.y.toFixed(3));
    el.setAttribute("r", pt.r.toFixed(3));
  }
}

function isActionPressed(
  action: string,
  settings: Settings,
  theme: Theme,
): boolean | undefined {
  const selectedTheme = themeFromAction(action);
  if (selectedTheme !== undefined) return selectedTheme === theme;
  const background = backgroundFromAction(action);
  if (background !== undefined) return background === settings.background;
  const rate = frameRateFromAction(action);
  if (rate !== undefined) return rate === settings.frameRate;
  switch (action) {
    case "range06":
      return Math.abs(settings.range - 0.62) < 0.05;
    case "range12":
      return Math.abs(settings.range - 1.25) < 0.05;
    case "range32":
      return Math.abs(settings.range - 3.2) < 0.05;
    case "blur10":
      return Math.abs(settings.blur - 1) < 0.05;
    case "blur16":
      return Math.abs(settings.blur - 1.65) < 0.05;
    case "speed075":
      return Math.abs(settings.speed - 0.75) < 0.05;
    case "speed100":
      return Math.abs(settings.speed - 1) < 0.05;
    case "speed125":
      return Math.abs(settings.speed - 1.25) < 0.05;
    case "toggle_blur":
      return settings.blur > 0;
    case "toggle_range":
      return settings.range > 0.9;
    case "toggle_motion":
      return settings.reducedMotion;
    case "toggle_sound":
      return settings.sound !== false;
    default:
      return undefined;
  }
}

export class Scene {
  private root: SVGSVGElement;
  private geometry: SVGGElement;
  private relationFilaments: SVGPathElement;
  private labels: SVGGElement;
  private reading: HTMLElement;
  private hudControls: HTMLElement;
  private backgroundRoot: SVGGElement;
  private backgroundFlow: SVGGElement;
  private backgroundStars: SVGGElement;
  private flowPaths: SVGPathElement[] = [];
  private flowMarkers: SVGCircleElement[] = [];
  private starPoints: SVGCircleElement[] = [];
  private starTrails: SVGPathElement[] = [];
  private meteorPaths: SVGPathElement[] = [];
  private meteorHeads: SVGCircleElement[] = [];
  private hubs = new Map<
    string,
    {
      auraPath: SVGPathElement;
      beacon: SVGTextElement;
      path: SVGPathElement;
      hit: SVGPathElement;
      tracePath: SVGPathElement;
      traceDot: SVGCircleElement;
      labels: Map<string, Label>;
    }
  >();
  readingBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null = null;
  private articles = new Map<string, HTMLElement>();
  readonly actions = new Map<string, Command>();
  private lastRenderKey = "";
  private lastState: FieldState | null = null;
  private heights = new Map<string, number>();
  private measuredSettings = "";
  private readonly articleRenderer: ArticleRenderer;
  private readonly localLabelTurns = new LocalLabelTurns();
  private symbolFeedback = new Map<string, SymbolInteractionState>();
  private hoveredTarget: string | null = null;
  private readonly options: Required<
    Pick<GraphicsOptions, "renderer" | "background">
  > & { dpr?: number };
  private resolvedKind: ResolvedRendererKind = "svg";
  private gpu: PixiGraphicsRenderer | null = null;
  private initPromise: Promise<void> | null = null;
  private destroyed = false;
  private frameRevision = 0;
  private currentFrame: SceneFrame;
  private backgroundCacheKey = "";
  private backgroundCache: BackgroundFrame | null = null;
  private loadingGeometry: LoadingGeometry | null = null;
  private loadingRoot: SVGGElement;
  private contentRevision = 0;
  private readonly amberColors = new Map<Theme, string>();

  setLoadingGeometry(geometry: LoadingGeometry | null): void { this.loadingGeometry = geometry; }

  invalidateContent(ids: readonly string[]): void {
    this.contentRevision++;
    const targets = new Set([...ids, ...ids.map((id) => `q_hit_${id}`)]);
    for (const key of this.heights.keys()) {
      if (targets.has(JSON.parse(key)[0])) this.heights.delete(key);
    }
  }

  private appendLoadingFrame(): void {
    const geometry = this.loadingGeometry;
    this.loadingRoot.style.display = geometry && !this.gpu ? "" : "none";
    if (!geometry) { this.loadingRoot.replaceChildren(); return; }
    if (!this.gpu) renderLoadingGeometry(this.loadingRoot, geometry);
    const primitives: import("../core/graphics.ts").ScenePrimitive[] = loadingShapes(geometry).map((shape) => {
      const style = { stroke: loadingToneColor(geometry.theme, shape.tone), strokeWidth: shape.weight, opacity: shape.opacity };
      if (shape.kind === "circle") return { type: "circle", cx: shape.cx, cy: shape.cy, radius: shape.r, ...style };
      if (shape.kind === "arc") return { type: "arc", cx: shape.cx, cy: shape.cy, radius: shape.r, startAngle: shape.startAngle, endAngle: shape.endAngle, anticlockwise: !shape.clockwise, ...style };
      return { type: "polyline", points: shape.points, closed: shape.closed, ...style };
    });
    this.currentFrame.layers.push(sceneLayer("loading", 70, primitives));
  }

  invalidateLayout(fontsChanged = false) {
    if (fontsChanged) this.articleRenderer.invalidateFonts();
    this.heights.clear();
    this.lastRenderKey = "";
    this.gpu?.invalidateGlyphs("font");
  }

  get isAnimating(): boolean {
    return this.localLabelTurns.isAnimating;
  }

  /** Concrete renderer chosen after `initialize` (WebGL or permanent SVG). */
  get rendererKind(): ResolvedRendererKind {
    return this.resolvedKind;
  }

  /** Last numeric scene frame. Both renderers consume this data. */
  get frame(): SceneFrame {
    return this.currentFrame;
  }

  /** Single CPU hit-test over the current frame's semantic regions. */
  hitTest(point: Vec): HitRegion | null {
    return hitTestFrame(this.currentFrame, point);
  }

  /**
   * Try WebGL once. Any failure (missing canvas, unsupported GPU, context loss)
   * permanently settles on SVG while retaining the latest FieldState.
   */
  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeRenderer();
    }
    return this.initPromise;
  }

  private async initializeRenderer(): Promise<void> {
    if (this.options.renderer === "svg") {
      this.resolvedKind = "svg";
      this.host.dataset.renderer = "svg";
      return;
    }
    if (this.gpu && !this.gpu.isLost) return;
    const canUseCanvas =
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      typeof document.createElement === "function";
    if (!canUseCanvas) {
      this.installSvgFallback();
      return;
    }
    try {
      const dpr =
        this.options.dpr ??
        (typeof window !== "undefined" && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1);
      const gpu = await PixiGraphicsRenderer.create({
        dpr,
        onContextLost: () => this.installSvgFallback(),
      });
      if (this.destroyed) {
        gpu.destroy();
        return;
      }
      this.gpu = gpu;
      this.resolvedKind = "webgl";
      this.host.dataset.renderer = "webgl";
      this.reading.before(gpu.canvas);
      this.lastRenderKey = "";
      if (this.lastState) this.render(this.lastState);
    } catch {
      this.installSvgFallback();
    }
  }

  private installSvgFallback(): void {
    if (this.resolvedKind === "svg" && !this.gpu) {
      this.host.dataset.renderer = "svg";
      return;
    }
    this.resolvedKind = "svg";
    this.host.dataset.renderer = "svg";
    this.gpu?.destroy();
    this.gpu = null;
    this.lastRenderKey = "";
    if (!this.destroyed && this.lastState) this.render(this.lastState);
  }

  private host: HTMLElement;
  private catalog: Catalog;
  constructor(host: HTMLElement, catalog: Catalog, options: GraphicsOptions = {}) {
    this.articleRenderer = new ArticleRenderer(catalog, {
      inlineIcon: (token, morph) => this.createInlineIconSvg(token, morph),
      iconShowcase: (hub) => this.buildIconShowcase(hub),
    });
    this.host = host;
    this.catalog = catalog;
    this.options = {
      renderer: options.renderer ?? "auto",
      background: options.background ?? true,
      dpr: options.dpr,
    };
    this.currentFrame = emptySceneFrame(
      this.resolvedKind,
      { width: 0, height: 0 },
      { x: 0, y: 0, z: 1, rotation: 0 },
      "light",
    );
    this.root = requireElement(host, "#world");
    this.loadingRoot = svg("g", this.root, { id: "gLoading", "aria-hidden": "true" });
    this.geometry = requireElement(host, "#gGeometry");
    this.labels = requireElement(host, "#gLabels");
    this.reading = requireElement(host, "#reading");
    this.hudControls = this.ensureHudControls(host);
    this.backgroundRoot = this.ensureBackgroundRoot();
    this.backgroundFlow = svg("g", this.backgroundRoot, {
      class: "background-flow",
    });
    this.backgroundStars = svg("g", this.backgroundRoot, {
      class: "background-stars",
    });
    this.relationFilaments = svg("path", this.geometry, {
      id: "relationFilaments",
      class: "relation-filaments",
      d: "",
    });
    for (const hub of catalog.definitions)
      this.hubs.set(hub.id, {
        auraPath: svg("path", this.geometry, {
          class: "hub-aura",
          "data-hub-id": hub.id,
        }),
        path: svg("path", this.geometry, {
          class: "curve",
          "data-hub-id": hub.id,
        }),
        tracePath: svg("path", this.geometry, {
          class: "inner-trace",
          "data-hub-id": hub.id,
        }),
        traceDot: svg("circle", this.geometry, {
          class: "inner-dot",
          "data-hub-id": hub.id,
          r: 2.2,
        }),
        beacon: svg("text", this.geometry, {
          class: "hub-beacon",
          "data-hub-id": hub.id,
        }),
        hit: svg("path", this.geometry, {
          class: "hit",
          "data-command": `hub:${hub.id}`,
        }),
        labels: new Map(),
      });
    this.bindSymbolFeedbackListeners();
    if (
      this.options.renderer !== "svg" &&
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      window.document === document
    ) {
      void this.initialize();
    }
  }

  private ensureBackgroundRoot(): SVGGElement {
    const existing = this.host.querySelector<SVGGElement>("#gSceneBackground");
    if (existing) return existing;
    const root = document.createElementNS(NS, "g");
    root.id = "gSceneBackground";
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("pointer-events", "none");
    this.geometry.parentNode?.insertBefore(root, this.geometry);
    // The Scene owns the numeric background now; the legacy SVG Background
    // instance stays available for its own tests but must not double-draw.
    const legacy = this.host.querySelector<SVGGElement>("#gDecorations");
    if (legacy) legacy.style.display = "none";
    return root;
  }

  private ensureBackgroundPools(frame: BackgroundFrame): void {
    for (let i = this.flowPaths.length; i < frame.streamlines.length; i++) {
      this.flowPaths.push(
        svg("path", this.backgroundFlow, {
          class: "flow-line",
          fill: "none",
          "stroke-width": 1.05,
        }),
      );
      this.flowMarkers.push(
        svg("circle", this.backgroundFlow, {
          class: "flow-marker",
          r: 1.7,
        }),
      );
    }
    for (let i = this.starPoints.length; i < frame.stars.length; i++)
      this.starPoints.push(
        svg("circle", this.backgroundStars, { class: "star-point" }),
      );
    for (let i = this.starTrails.length; i < frame.trails.length; i++)
      this.starTrails.push(
        svg("path", this.backgroundStars, {
          class: "star-trail",
          fill: "none",
          "stroke-linecap": "round",
        }),
      );
    for (let i = this.meteorPaths.length; i < frame.meteors.length; i++) {
      this.meteorPaths.push(
        svg("path", this.backgroundStars, {
          class: "star-meteor",
          fill: "none",
          "stroke-linecap": "round",
        }),
      );
      this.meteorHeads.push(
        svg("circle", this.backgroundStars, { class: "meteor-head" }),
      );
    }
  }

  private renderSvgBackground(frame: BackgroundFrame): void {
    this.ensureBackgroundPools(frame);
    const flowVisible = frame.mode === "flow";
    const starsVisible = frame.mode === "stars";
    const flowDisplay = flowVisible ? "" : "none";
    if (this.backgroundFlow.style.display !== flowDisplay)
      this.backgroundFlow.style.display = flowDisplay;
    const starsDisplay = starsVisible ? "" : "none";
    if (this.backgroundStars.style.display !== starsDisplay)
      this.backgroundStars.style.display = starsDisplay;
    this.backgroundRoot.style.opacity =
      frame.mode === "none" ? "0" : String(frame.opacity);
    if (flowVisible) {
      frame.streamlines.forEach((line, i) => {
        const path = this.flowPaths[i];
        const d = line.points
          .map(
            (point, index) =>
              `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
          )
          .join("");
        path.setAttribute("d", d);
        path.setAttribute("stroke-width", String(line.width));
        path.style.opacity = String(line.opacity);
        const marker = this.flowMarkers[i];
        marker.setAttribute("cx", line.marker.x.toFixed(2));
        marker.setAttribute("cy", line.marker.y.toFixed(2));
        marker.setAttribute("r", String(line.markerRadius));
        marker.style.opacity = String(line.markerOpacity);
      });
      for (let i = frame.streamlines.length; i < this.flowPaths.length; i++) {
        this.flowPaths[i].style.display = "none";
        this.flowMarkers[i].style.display = "none";
      }
      return;
    }
    if (!starsVisible) return;
    frame.stars.forEach((star, i) => {
      const point = this.starPoints[i];
      point.style.display = "";
      point.setAttribute("cx", star.at.x.toFixed(2));
      point.setAttribute("cy", star.at.y.toFixed(2));
      point.setAttribute("r", String(star.radius));
      point.setAttribute("fill", star.fill);
      point.style.opacity = String(star.opacity);
    });
    for (let i = frame.stars.length; i < this.starPoints.length; i++)
      this.starPoints[i].style.display = "none";
    frame.trails.forEach((trail, i) => {
      const start = {
        x: trail.center.x + Math.cos(trail.startAngle) * trail.radius,
        y: trail.center.y + Math.sin(trail.startAngle) * trail.radius,
      };
      const end = {
        x: trail.center.x + Math.cos(trail.endAngle) * trail.radius,
        y: trail.center.y + Math.sin(trail.endAngle) * trail.radius,
      };
      const path = this.starTrails[i];
      path.setAttribute(
        "d",
        `M${start.x.toFixed(2)} ${start.y.toFixed(2)}A${trail.radius.toFixed(2)} ${trail.radius.toFixed(2)} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
      );
      path.setAttribute("stroke", trail.color);
      path.setAttribute("stroke-width", String(trail.width));
      path.style.opacity = String(trail.opacity);
    });
    for (let i = frame.trails.length; i < this.starTrails.length; i++)
      this.starTrails[i].style.opacity = "0";
    frame.meteors.forEach((meteor, i) => {
      const path = this.meteorPaths[i];
      path.style.display = "";
      path.setAttribute(
        "d",
        `M${meteor.from.x.toFixed(2)} ${meteor.from.y.toFixed(2)}L${meteor.to.x.toFixed(2)} ${meteor.to.y.toFixed(2)}`,
      );
      path.setAttribute("stroke", meteor.color);
      path.setAttribute("stroke-width", String(meteor.width));
      path.style.opacity = String(meteor.opacity);
      const head = this.meteorHeads[i];
      head.style.display = "";
      head.setAttribute("cx", meteor.head.x.toFixed(2));
      head.setAttribute("cy", meteor.head.y.toFixed(2));
      head.setAttribute("r", String(meteor.headRadius));
      head.setAttribute("fill", meteor.color);
      head.style.opacity = String(meteor.opacity);
    });
    for (let i = frame.meteors.length; i < this.meteorPaths.length; i++) {
      this.meteorPaths[i].style.display = "none";
      this.meteorHeads[i].style.display = "none";
    }
  }

  private ensureHudControls(host: HTMLElement): HTMLElement {
    let nav = host.querySelector<HTMLElement>("#hudControls");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "hudControls";
      nav.className = "hud-controls";
      nav.setAttribute("aria-label", "全域与传统全局索引");
      nav.hidden = true;
      const items: Array<{ key: string; label: string; title: string }> = [
        { key: "hud:back", label: "↶ 返回", title: "返回上一位置" },
        { key: "hud:overview", label: "⊙ 全域", title: "切换全域观察" },
        { key: "hud:refocus", label: "⌖ 聚焦", title: "回到聚焦枢" },
        { key: "hud:search", label: "⌕ 检索", title: "打开检索枢" },
        { key: "hud:settings", label: "⚙ 设置", title: "打开设置枢" },
        { key: "hud:sound", label: "♪ 声场", title: "切换几何声场" },
      ];
      for (const item of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hud-btn";
        btn.dataset.command = item.key;
        btn.title = item.title;
        btn.setAttribute("aria-label", item.label);
        const glyph = Array.from(item.label)[0];
        const token = resolveIconToken(glyph);
        if (token)
          btn.append(
            this.createInlineIconSvg(token),
            document.createTextNode(item.label.slice(glyph.length)),
          );
        else btn.textContent = item.label;
        nav.append(btn);
      }
      host.append(nav);
    }
    return nav;
  }

  private bindSymbolFeedbackListeners() {
    const resolveTagKey = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const group = target.closest<SVGGElement>(".tag-group[data-symbol-kind]");
      return group?.dataset.command ?? null;
    };
    this.labels.addEventListener("pointerover", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { hover: true });
    });
    this.labels.addEventListener("pointerout", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { hover: false, press: false });
    });
    this.labels.addEventListener("pointerdown", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { press: true });
    });
    this.labels.addEventListener("pointerup", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { press: false });
    });
    this.labels.addEventListener("focusin", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { focus: true });
    });
    this.labels.addEventListener("focusout", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { focus: false, press: false });
    });
    const resolveRelationalTarget = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const inlineBtn = target.closest<HTMLElement>(".inline-ref[data-target]");
      if (inlineBtn?.dataset.target && !inlineBtn.dataset.target.startsWith("act:")) {
        return inlineBtn.dataset.target;
      }
      const cmdEl = target.closest<SVGElement>("[data-command]");
      if (cmdEl?.dataset.command) {
        const cmd = this.actions.get(cmdEl.dataset.command);
        if (cmd?.type === "navigate" && !cmd.target.startsWith("act:")) return cmd.target;
        if (cmd?.type === "focus") return `hub:${cmd.hub}`;
      }
      return null;
    };
    const onOver = (e: Event) => {
      const next = resolveRelationalTarget(e.target);
      if (next !== this.hoveredTarget) this.setHoveredTarget(next);
    };
    const onOut = (e: Event) => {
      if (this.hoveredTarget && resolveRelationalTarget(e.target) === this.hoveredTarget) {
        this.setHoveredTarget(null);
      }
    };
    this.reading.addEventListener("pointerover", onOver);
    this.reading.addEventListener("pointerout", onOut);
    this.reading.addEventListener("focusin", onOver);
    this.reading.addEventListener("focusout", onOut);
    this.labels.addEventListener("pointerover", onOver);
    this.labels.addEventListener("pointerout", onOut);
    this.geometry.addEventListener("pointerover", onOver);
    this.geometry.addEventListener("pointerout", onOut);
  }

  setHoveredTarget(target: string | null) {
    if (this.hoveredTarget === target) return;
    this.hoveredTarget = target;
    if (this.lastState) {
      this.lastRenderKey = "";
      this.render(this.lastState);
    }
  }

  /**
   * Update orthogonal interaction feedback state (Hover / Focus / Press / Active)
   * on a Symbol Morph icon without altering the host Hub's morph or camera state.
   */
  setSymbolInteraction(
    commandKey: string,
    patch: Partial<SymbolInteractionState>,
  ) {
    const current = this.symbolFeedback.get(commandKey) ?? {
      hover: false,
      focus: false,
      press: false,
      active: false,
    };
    const next: SymbolInteractionState = { ...current, ...patch };
    this.symbolFeedback.set(commandKey, next);
    if (this.lastState) {
      this.lastRenderKey = "";
      this.render(this.lastState);
    }
  }

  getSymbolActivity(
    commandKey: string,
    kind: SymbolKind,
    s?: FieldState | null,
  ): number {
    const fb = this.symbolFeedback.get(commandKey);
    const semanticActive =
      fb?.active ||
      Boolean(
        s &&
        ((kind === "overview" && s.overview) ||
          (kind === "search" && !s.overview && s.focus === "Q") ||
          (kind === "settings" && !s.overview && s.focus === "S")),
      );
    let activity = semanticActive ? 0.35 : 0;
    if (fb?.hover || fb?.focus) activity = Math.max(activity, 0.62);
    if (fb?.press) activity = 1.0;
    return clamp(activity, 0, 1);
  }

  private selected(hub: Hub) {
    return this.catalog.get(hub.path.at(-1)!);
  }
  private label(
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
  ) {
    const pool = this.hubs.get(hub.id)!.labels;
    let entry = pool.get(key);
    if (!entry) {
      const group = svg("g", this.labels, {
        class: "tag-group",
        tabindex: 0,
        role: "button",
      });
      const pin = svg("circle", group, {
        class: "page-pin",
        cx: 0,
        cy: 0,
        r: 2.6,
      });
      const leaf = svg("g", group, { class: "page-leaf" });
      const stem = svg("path", leaf);
      const ring = svg("circle", leaf, { class: "label-ring", r: 16 });
      const icon = svg("svg", leaf, {
        class: "label-icon",
        viewBox: "0 0 24 24",
        width: 20,
        height: 20,
        x: -10,
        y: -10,
        overflow: "visible",
      });
      const iconGlyph = svg("g", icon, { class: "label-icon-glyph" });
      const text = svg("text", leaf);
      const hit = svg("rect", leaf, { class: "label-hit", height: 44, rx: 8 });
      entry = {
        group,
        leaf,
        pin,
        stem,
        ring,
        icon,
        iconGlyph,
        text,
        hit,
        symbolPaths: new Map(),
        symbolPoints: new Map(),
      };
      pool.set(key, entry);
    }
    const e = entry,
      id = `${hub.id}:${key}`;
    const interactive = !page || page.interactive;
    if (interactive) this.actions.set(id, command);
    e.group.style.display = "";
    const feedback = this.symbolFeedback.get(id);
    if (alpha >= 0.999 && attachment?.role === "operation" && this.host.dataset.discoveryStage === "threshold" && !feedback?.hover && !feedback?.focus)
      alpha = 0.42;
    e.group.style.opacity = alpha < 0.999 ? String(alpha) : "";
    const zoom = state?.camera.z ?? 1;
    e.group.setAttribute(
      "transform",
      `translate(${anchor.x} ${anchor.y}) scale(${zoom})`,
    );
    e.group.classList.toggle("turning", !!page);
    e.pin.style.opacity = page && kind === "current" ? "1" : "0";
    e.hit.style.pointerEvents = interactive ? "" : "none";
    e.group.setAttribute("tabindex", interactive ? "0" : "-1");
    e.group.setAttribute("aria-hidden", interactive ? "false" : "true");
    e.group.dataset.command = id;
    if (attachment) {
      e.group.dataset.scope = attachment.scope;
      e.group.dataset.role = attachment.role;
      e.group.dataset.anchor = attachment.anchor.id;
      e.group.dataset.hostHub = attachment.anchor.hostHub;
      e.group.dataset.side = attachment.side;
    }
    if (key.startsWith("local:")) e.group.dataset.localScroll = hub.id;
    else delete e.group.dataset.localScroll;
    e.group.classList.toggle("is-current", kind === "current");
    e.group.setAttribute("aria-label", aria);

    const deltaX = (at.x - anchor.x) / zoom,
      deltaY = (at.y - anchor.y) / zoom;
    const dist = Math.hypot(deltaX, deltaY);
    const stemTier =
      attachment?.role === "operation"
        ? "global"
        : attachment?.role === "local"
          ? "local"
          : kind === "current"
            ? "current"
            : "ordinary";
    const stemEnd = Math.max(4, dist - 14);
    const sx = dist > 1e-4 ? (deltaX / dist) * stemEnd : deltaX;
    const sy = dist > 1e-4 ? (deltaY / dist) * stemEnd : deltaY;
    e.stem.setAttribute(
      "class",
      `stem stem-${stemTier}${kind === "nav" ? " nav" : ""}`,
    );
    e.stem.dataset.stemTier = stemTier;
    e.stem.dataset.stemLength = stemEnd.toFixed(1);
    e.stem.setAttribute("d", `M0 0L${sx.toFixed(2)} ${sy.toFixed(2)}`);

    const stemAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
    const flip = page ? page.squash : 1;
    e.leaf.setAttribute(
      "transform",
      `rotate(${stemAngle}) scale(${flip} 1) rotate(${-stemAngle})`,
    );
    e.leaf.style.opacity = page ? String(page.opacity) : "";
    while (degree > 90) degree -= 180;
    while (degree < -90) degree += 180;
    // Label geometry stays local; the parent scales typography, icons and hit targets together.
    const labelTransform = `translate(${deltaX} ${deltaY}) rotate(${degree})`;
    e.ring.setAttribute("cx", "0");
    e.ring.setAttribute("cy", "0");
    e.ring.setAttribute("transform", labelTransform);

    const symbolKind =
      attachment?.symbolKind ??
      (attachment?.scope === "global" ? resolveSymbolKind(name) : undefined);
    const iconToken = attachment?.icon ?? resolveIconToken(name);
    const contentKind =
      attachment?.contentKind ??
      (symbolKind || iconToken ? "icon" : classifyLabelContent(name));
    e.group.dataset.contentKind = contentKind;
    e.group.classList.toggle("has-icon", Boolean(symbolKind || iconToken));

    if (iconToken) {
      if (symbolKind) e.group.dataset.symbolKind = symbolKind;
      else delete e.group.dataset.symbolKind;
      const fb = this.symbolFeedback.get(id);
      e.group.classList.toggle("is-hovered", Boolean(fb?.hover));
      e.group.classList.toggle("is-pressed", Boolean(fb?.press));
      e.group.classList.toggle("is-focused", Boolean(fb?.focus));
      e.group.classList.toggle(
        "is-active-symbol",
        Boolean(
          symbolKind && this.getSymbolActivity(id, symbolKind, state) >= 0.35,
        ),
      );
      e.group.dataset.icon = iconToken.iconName;
      e.icon.style.display = "";
      e.icon.setAttribute("class", `label-icon ${kind}`);
      e.icon.setAttribute("transform", labelTransform);
      if (e.renderedIconId !== iconToken.id) {
        populateIconGlyph(e.iconGlyph, iconToken);
        e.renderedIconId = iconToken.id;
      }
      e.text.setAttribute("class", `label ${kind} is-sr-only`);
      e.text.textContent = name;
      e.text.setAttribute("transform", labelTransform);
    } else {
      delete e.group.dataset.symbolKind;
      delete e.group.dataset.symbolMorph;
      delete e.group.dataset.symbolActivity;
      delete e.group.dataset.icon;
      e.icon.style.display = "none";
      const subClass = contentKind === "symbol" ? "is-symbol" : "is-text";
      e.text.setAttribute("class", `label ${kind} ${subClass}`);
      e.text.setAttribute("x", "0");
      e.text.setAttribute("y", "0");
      e.text.textContent = name;
      e.text.setAttribute("transform", labelTransform);
    }

    const width =
      symbolKind || iconToken ? 44 : Math.max(44, name.length * 14 + 20);
    e.hit.setAttribute("x", String(-width / 2));
    e.hit.setAttribute("y", "-22");
    e.hit.setAttribute("width", String(width));
    e.hit.setAttribute("transform", labelTransform);

    const frameLabel: LabelFrame = {
      id,
      command,
      aria,
      hubId: hub.id,
      attachment,
      glyph: name,
      visual: kind,
      contentKind,
      layout: {
        hinge: anchor,
        position: at,
        offset: { x: deltaX, y: deltaY },
        degree,
        width,
        height: 44,
        scale: zoom,
      },
      opacity: alpha,
      interactive,
      localScrollHub: key.startsWith("local:") ? hub.id : undefined,
      icon: iconToken,
      symbolKind,
      symbolGeometry: attachment?.symbolGeometry,
      symbolActivity: symbolKind
        ? this.getSymbolActivity(id, symbolKind, state)
        : undefined,
      interaction: this.symbolFeedback.get(id),
      page,
      linkTarget:
        command.type === "navigate" ? command.target : undefined,
    };
    this.currentFrame.labels.push(frameLabel);
    if (interactive) {
      this.currentFrame.hitRegions.push({
        id,
        command,
        aria,
        hubId: hub.id,
        chapterId:
          attachment?.role === "ordinary" ? attachment.id : undefined,
        localScrollHub: key.startsWith("local:") ? hub.id : undefined,
        graspKind: "label",
        shape: {
          type: "rect",
          x: at.x,
          y: at.y,
          width: width * zoom,
          height: 44 * zoom,
          rotation: degree,
        },
        priority: 30,
      });
    }
  }

  private renderUnfocusedTraces(
    h: Hub,
    nodes: Chapter[],
    s: FieldState,
    perception?: HubPerception,
    darkPalette = false,
    primitives: ScenePrimitive[] = [],
  ) {
    const entry = this.hubs.get(h.id)!;
    if (s.loading || (h.id === s.focus && !s.overview)) {
      entry.tracePath.setAttribute("d", "");
      entry.tracePath.style.display = "none";
      entry.traceDot.style.display = "none";
      entry.beacon.style.display = "none";
      return;
    }
    const sig = perception?.signature;
    const tickScale = sig ? sig.tickScale : 1;
    const strokeColor = sig
      ? darkPalette
        ? sig.darkStroke
        : sig.lightStroke
      : "";
    const segs: string[] = [];
    const activeIdx =
      ((Math.round(h.scroll) % nodes.length) + nodes.length) % nodes.length;
    let dotPt: Vec | null = null;
    let beaconPt: Vec | null = null;
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
      segs.push(
        `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}L${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      );
      primitives.push({
        type: "polyline",
        points: [p0, p1],
        stroke: strokeColor,
        strokeWidth: 0.9 * s.camera.z,
        opacity: perception?.traceOpacity ?? 0.2,
      });
      if (sig && (sig.archetype === "origin" || sig.archetype === "portal" || sig.archetype === "instrument")) {
        const pOut = hubToScreen(
          h,
          material(h, param, isSelected ? 9 : 4.5),
          s.camera,
          s.viewport,
        );
        segs.push(
          `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}L${pOut.x.toFixed(2)} ${pOut.y.toFixed(2)}`,
        );
        primitives.push({
          type: "polyline",
          points: [p0, pOut],
          stroke: strokeColor,
          strokeWidth: 0.75 * s.camera.z,
          opacity: perception?.traceOpacity ?? 0.2,
        });
      }
      if (isSelected) {
        dotPt = hubToScreen(
          h,
          material(h, param, baseLen - 5.5),
          s.camera,
          s.viewport,
        );
        beaconPt = hubToScreen(
          h,
          material(h, param, baseLen - 22),
          s.camera,
          s.viewport,
        );
      }
    }
    entry.tracePath.style.display = "";
    entry.tracePath.setAttribute("d", segs.join(""));
    if (strokeColor) entry.tracePath.style.stroke = strokeColor;
    if (perception) {
      entry.tracePath.style.opacity = String(perception.traceOpacity);
    }
    if (dotPt) {
      const dotScale = perception ? perception.dotScale : 1;
      entry.traceDot.style.display = "";
      entry.traceDot.setAttribute("cx", dotPt.x.toFixed(2));
      entry.traceDot.setAttribute("cy", dotPt.y.toFixed(2));
      entry.traceDot.setAttribute("r", String(2.4 * dotScale * s.camera.z));
      if (sig) entry.traceDot.style.fill = sig.accentColor;
      entry.traceDot.classList.toggle(
        "is-resonating",
        perception?.tier === "resonating",
      );
      primitives.push({
        type: "circle",
        cx: dotPt.x,
        cy: dotPt.y,
        radius: 2.4 * dotScale * s.camera.z,
        fill: sig?.accentColor ?? strokeColor,
        opacity: perception?.traceOpacity ?? 0.2,
      });
    } else {
      entry.traceDot.style.display = "none";
    }
    if (beaconPt && perception && perception.beaconOpacity > 0.05) {
      entry.beacon.style.display = "";
      entry.beacon.setAttribute("x", beaconPt.x.toFixed(2));
      entry.beacon.setAttribute("y", beaconPt.y.toFixed(2));
      if (entry.beacon.textContent !== h.glyph) {
        entry.beacon.textContent = h.glyph;
      }
      const fontScale =
        perception.tier === "resonating"
          ? 16.5
          : perception.tier === "related"
            ? 14.5
            : 12;
      entry.beacon.style.fontSize = `${(fontScale * Math.max(0.55, s.camera.z)).toFixed(1)}px`;
      entry.beacon.style.opacity = String(perception.beaconOpacity);
      entry.beacon.style.fill =
        perception.tier === "resonating" && sig
          ? sig.accentColor
          : strokeColor;
      entry.beacon.dataset.tier = perception.tier;
      primitives.push({
        type: "text",
        x: beaconPt.x,
        y: beaconPt.y,
        text: h.glyph,
        fontSize: fontScale,
        scale: Math.max(0.55, s.camera.z),
        fill:
          perception.tier === "resonating" && sig
            ? sig.accentColor
            : strokeColor,
        align: "center",
        baseline: "middle",
        opacity: perception.beaconOpacity,
      });
    } else {
      entry.beacon.style.display = "none";
    }
  }

  private updateHudControls(s: FieldState, showTraditionalHud: boolean) {
    this.actions.set("hud:back", { type: "back" });
    this.actions.set("hud:overview", { type: "overview" });
    this.actions.set("hud:refocus", { type: "focus", hub: s.focus });
    this.actions.set("hud:search", { type: "navigate", target: "q0" });
    this.actions.set("hud:settings", { type: "navigate", target: "s0" });
    this.actions.set("hud:sound", {
      type: "navigate",
      target: "act:toggle_sound",
    });

    this.hudControls.hidden = !showTraditionalHud || s.loading;
    if (!showTraditionalHud || s.loading) return;

    const backBtn = this.hudControls.querySelector<HTMLButtonElement>(
      '[data-command="hud:back"]',
    );
    if (backBtn) backBtn.disabled = s.history.length === 0;
    const overviewBtn = this.hudControls.querySelector<HTMLButtonElement>(
      '[data-command="hud:overview"]',
    );
    if (overviewBtn)
      overviewBtn.setAttribute("aria-pressed", String(s.overview));
    const soundBtn = this.hudControls.querySelector<HTMLButtonElement>(
      '[data-command="hud:sound"]',
    );
    if (soundBtn)
      soundBtn.setAttribute("aria-pressed", String(s.settings.sound !== false));
  }

  render(s: FieldState) {
    this.lastState = s;
    const focusedHub = s.hubs[s.focus];
    const focusedEntries =
      s.overview || s.loading
        ? []
        : ordinaryAndLocalAttachments(
            focusedHub,
            this.selected(focusedHub),
            this.catalog.siblings(
              this.selected(focusedHub).id,
              s.searchResults,
            ),
            s.camera,
            s.viewport,
          );
    const locals = this.localLabelTurns.update(
      `${s.focus}:${this.selected(focusedHub).id}`,
      s.passage ? [] : focusedEntries.filter((entry) => entry.role === "local"),
      s.elapsed,
      s.settings.reducedMotion,
    );
    const feedbackSig = [...this.symbolFeedback.entries()].map(([k, v]) => [
      k,
      v.hover,
      v.focus,
      v.press,
      v.active,
    ]);
    const key = JSON.stringify([
      s.camera,
      s.viewport,
      this.contentRevision,
      this.loadingGeometry,
      s.focus,
      s.overview,
      s.loading,
      s.theme,
      s.settings,
      s.description,
      s.searchQuery,
      s.searchResults,
      s.history.length,
      s.passage?.phase,
      s.morphTurn?.phase,
      s.contentTurn?.phase,
      feedbackSig,
      this.hoveredTarget,
      locals.map((leaf) => [
        leaf.attachment.anchor.id,
        leaf.visibility,
        leaf.phase,
      ]),
      Object.values(s.hubs).map((h) => [
        h.id,
        h.angle,
        h.anchorOffset,
        h.readingBearing,
        h.morph,
        h.fold,
        h.scroll,
        h.localScroll,
        h.textOffset,
        h.path,
      ]),
    ]);
    if (key === this.lastRenderKey) {
      this.refreshBackgroundFrame(s);
      if (this.gpu) this.gpu.render(this.currentFrame);
      else if (this.currentFrame.background && s.settings.background !== "none" && !s.settings.reducedMotion)
        this.renderSvgBackground(this.currentFrame.background);
      return;
    }
    this.lastRenderKey = key;
    this.currentFrame = emptySceneFrame(
      this.resolvedKind,
      s.viewport,
      s.camera,
      s.theme,
    );
    this.currentFrame.revision = ++this.frameRevision;
    this.host.style.setProperty("--camera-scale", String(s.camera.z));
    const settingsKey = JSON.stringify(s.settings);
    if (this.measuredSettings !== settingsKey) {
      this.heights.clear();
      this.measuredSettings = settingsKey;
    }
    this.root.setAttribute(
      "viewBox",
      `0 0 ${s.viewport.width} ${s.viewport.height}`,
    );
    this.actions.clear();
    for (const { labels } of this.hubs.values())
      for (const e of labels.values()) e.group.style.display = "none";

    const contentTurn = s.contentTurn;
    const turnPose = contentTurn
      ? pageTurnPose(
          contentTurn.phase,
          s.settings.reducedMotion,
          contentTurn.direction,
        )
      : null;
    const chapterEnvelope = s.passage ? readingEnvelope(s.passage.phase) : 1;

    const perception = evaluatePerception(s, this.catalog, this.hoveredTarget);
    if (this.host.dataset.discoveryStage !== perception.stage) {
      this.host.dataset.discoveryStage = perception.stage;
    }
    if (perception.resonatingHubId) {
      this.host.dataset.resonatingHub = perception.resonatingHubId;
    } else {
      delete this.host.dataset.resonatingHub;
    }

    const visualThemeForField =
      s.passage && s.passage.phase >= 0.5 ? s.passage.theme : s.theme;
    this.currentFrame.visualTheme = visualThemeForField;
    this.host.ownerDocument.documentElement.dataset.theme = visualThemeForField;
    if (!this.amberColors.has(visualThemeForField)) {
      const color = this.host.ownerDocument.defaultView?.getComputedStyle(this.host.ownerDocument.documentElement).getPropertyValue("--amber").trim();
      this.amberColors.set(visualThemeForField, color || BOUNDARY[visualThemeForField]);
    }
    const relationColor = this.amberColors.get(visualThemeForField)!;
    const relationOpacity = s.loading ? 0 : perception.resonatingHubId ? 0.46 : s.overview ? 0.34 : 0.22;
    const darkPalette = isDarkTheme(visualThemeForField);
    const filamentSegs: string[] = [];
    const hubPrimitives: ScenePrimitive[] = [];
    const relationPrimitives: ScenePrimitive[] = [];
    const focusHubObj = s.hubs[perception.focusedHubId] ?? s.hubs[s.focus];
    const focusSibs = this.catalog.siblings(
      this.selected(focusHubObj).id,
      s.searchResults,
    );
    const focusAnchorScreen = hubToScreen(
      focusHubObj,
      material(
        focusHubObj,
        nodeS(focusHubObj, focusHubObj.scroll, focusSibs.length, s.camera, s.viewport),
        0,
      ),
      s.camera,
      s.viewport,
    );

    for (const h of Object.values(s.hubs)) {
      const entry = this.hubs.get(h.id)!,
        active = h.id === s.focus && !s.overview && !s.loading,
        hubPerception = perception.hubs[h.id],
        sig = hubPerception.signature;
      const strokeColor = darkPalette ? sig.darkStroke : sig.lightStroke;
      const curve = evaluateHubCurve(h, s.camera, s.viewport);
      const path = curveToSvgPath(curve);
      entry.path.setAttribute("d", path);
      entry.hit.setAttribute("d", path);
      hubPrimitives.push(
        curveToPrimitive(curve, {
          stroke: strokeColor,
          strokeWidth: 1.25 * hubPerception.strokeWidthScale * s.camera.z,
          opacity: hubPerception.curveOpacity,
          dash:
            !active &&
            sig.curveDash &&
            hubPerception.tier !== "resonating"
              ? sig.curveDash.split(/\s+/).map(Number)
              : undefined,
        }),
      );
      this.currentFrame.hitRegions.push({
        id: `hub:${h.id}`,
        command: active
          ? { type: "morph" }
          : { type: "focus", hub: h.id },
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
          ? evaluateHubAuraCurve(
              h,
              s.camera,
              s.viewport,
              sig.auraOffset,
            )
          : null;
      const auraD = auraCurve ? curveToSvgPath(auraCurve, false) : "";
      entry.auraPath.setAttribute("d", auraD);
      entry.auraPath.style.display = auraD ? "" : "none";
      entry.auraPath.style.opacity = String(hubPerception.auraOpacity);
      entry.auraPath.style.stroke =
        hubPerception.tier === "resonating" ? sig.accentColor : strokeColor;
      if (sig.auraDash) {
        entry.auraPath.setAttribute("stroke-dasharray", sig.auraDash);
      } else {
        entry.auraPath.removeAttribute("stroke-dasharray");
      }
      if (auraCurve) {
        hubPrimitives.push(
          curveToPrimitive(auraCurve, {
            stroke:
              hubPerception.tier === "resonating"
                ? sig.accentColor
                : strokeColor,
            strokeWidth: 0.9 * s.camera.z,
            opacity: hubPerception.auraOpacity,
            dash: sig.auraDash
              ? sig.auraDash.split(/\s+/).map(Number)
              : undefined,
          }),
        );
      }

      const tierClass =
        hubPerception.tier === "resonating"
          ? " related is-resonating"
          : hubPerception.tier === "related"
            ? " related"
            : hubPerception.tier === "ambient"
              ? " is-ambient"
              : "";
      entry.path.setAttribute(
        "class",
        `curve${active ? " selected" : ""}${tierClass}`,
      );
      entry.path.dataset.tier = hubPerception.tier;
      entry.path.dataset.relation = hubPerception.relation;
      entry.path.dataset.archetype = sig.archetype;
      entry.path.style.opacity = String(hubPerception.curveOpacity);
      entry.path.style.stroke =
        hubPerception.tier === "resonating" ? sig.accentColor : strokeColor;
      entry.path.style.strokeWidth = `calc(${(1.25 * hubPerception.strokeWidthScale).toFixed(2)}px * var(--camera-scale, 1))`;
      if (!active && sig.curveDash && hubPerception.tier !== "resonating") {
        entry.path.setAttribute("stroke-dasharray", sig.curveDash);
      } else {
        entry.path.removeAttribute("stroke-dasharray");
      }

      this.actions.set(
        `hub:${h.id}`,
        active ? { type: "morph" } : { type: "focus", hub: h.id },
      );
      const current = this.selected(h);
      const nodes = this.catalog.siblings(current.id, s.searchResults);
      this.renderUnfocusedTraces(
        h,
        nodes,
        s,
        hubPerception,
        darkPalette,
        hubPrimitives,
      );

      if (
        !s.loading &&
        h.id !== focusHubObj.id &&
        (hubPerception.tier === "resonating" || hubPerception.tier === "related")
      ) {
        const targetParam = nodeS(h, h.scroll, nodes.length, s.camera, s.viewport);
        const targetScreen = hubToScreen(
          h,
          material(h, targetParam, 0),
          s.camera,
          s.viewport,
        );
        const mx = (focusAnchorScreen.x + targetScreen.x) * 0.5;
        const my = (focusAnchorScreen.y + targetScreen.y) * 0.5;
        const dx = targetScreen.x - focusAnchorScreen.x;
        const dy = targetScreen.y - focusAnchorScreen.y;
        const cx = mx - dy * 0.12;
        const cy = my + dx * 0.12;
        if (
          Number.isFinite(
            focusAnchorScreen.x + focusAnchorScreen.y + cx + cy + targetScreen.x + targetScreen.y,
          )
        ) {
          filamentSegs.push(
            `M${focusAnchorScreen.x.toFixed(1)} ${focusAnchorScreen.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${targetScreen.x.toFixed(1)} ${targetScreen.y.toFixed(1)}`,
          );
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
        this.label(
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

    this.relationFilaments.setAttribute("d", filamentSegs.join(""));
    this.relationFilaments.style.opacity = s.loading
      ? "0"
      : perception.resonatingHubId
        ? "0.46"
        : s.overview
          ? "0.34"
          : "0.22";
    this.currentFrame.layers.push(
      sceneLayer("hubs", 30, hubPrimitives),
      sceneLayer("relations", 40, relationPrimitives),
    );

    for (const leaf of locals) {
      const attachment = leaf.attachment;
      const hub = s.hubs[attachment.anchor.hostHub];
      const point = projectAttachment(hub, attachment, s.camera, s.viewport, 1);
      this.label(
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
      const labelGroup = this.hubs
        .get(hub.id)!
        .labels.get(attachment.anchor.id)!.group;
      labelGroup.dataset.localPhase = leaf.phase;
      const isResonatingRef =
        attachment.command.type === "navigate" &&
        (attachment.command.target === perception.resonatingTargetId ||
          (perception.resonatingHubId !== null &&
            this.catalog.chapters.get(attachment.command.target)?.hub ===
              perception.resonatingHubId));
      labelGroup.classList.toggle("is-resonating-ref", isResonatingRef);
      this.currentFrame.labels[this.currentFrame.labels.length - 1].resonating = isResonatingRef;
    }

    const useTraditionalHud =
      s.overview || s.camera.z < TRADITIONAL_HUD_ZOOM_THRESHOLD;
    this.updateHudControls(s, useTraditionalHud);

    if (!s.loading && !useTraditionalHud) {
      const owner = resolveGlobalHostHub(s);
      const materialSide: 1 | -1 = 1;
      for (const attachment of globalAttachments(s, this.catalog)) {
        const point = projectAttachment(
          owner,
          attachment,
          s.camera,
          s.viewport,
          materialSide,
        );
        // Global operation labels do NOT animate or fade during hub-switching passage.
        this.label(
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
    this.renderTexts(s);
    this.labels.style.opacity = "";
    this.labels.style.pointerEvents =
      this.resolvedKind === "webgl" || s.passage ? "none" : "";
    this.geometry.style.pointerEvents =
      this.resolvedKind === "webgl" ? "none" : "";
    const visualTheme =
      s.passage && s.passage.phase >= 0.5 ? s.passage.theme : s.theme;
    this.host.ownerDocument.documentElement.dataset.theme = visualTheme;
    const t = s.passage;
    const bgMix = t ? ease(clamp((t.phase - 0.42) / 0.58, 0, 1)) : 1;
    const baseFill = t
      ? blendHex(PAPER[t.sourceTheme], PAPER[t.theme], bgMix)
      : PAPER[s.theme];
    requireElement(this.host, "#baseBg").setAttribute("fill", baseFill);
    this.currentFrame.layers.unshift(
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
    const portal = requireElement<SVGGElement>(this.host, "#portalViewport"),
      stroke = requireElement<SVGPathElement>(this.host, "#portalStroke"),
      echo = requireElement<SVGPathElement>(this.host, "#portalEchoStroke");
    if (t) {
      this.host.dataset.transition = "passage";
      this.host.dataset.transitionKind = t.kind;
      this.host.dataset.direction = t.direction;
    } else {
      delete this.host.dataset.transition;
      delete this.host.dataset.transitionKind;
      delete this.host.dataset.direction;
    }
    if (t && needsColorSweep(t.sourceTheme, t.theme)) {
      const geometry = evaluatePassageGeometry(t, s.camera, s.viewport);
      portal.setAttribute("visibility", "visible");
      const portalAlpha =
        ease(clamp(t.phase / 0.12, 0, 1)) *
        ease(clamp((1 - t.phase) / 0.12, 0, 1));
      portal.style.opacity = String(portalAlpha);
      requireElement(this.host, "#portalBoundaryPath").setAttribute(
        "d",
        clipToSvgPath(geometry.boundary),
      );
      requireElement(this.host, "#portalBg").setAttribute(
        "fill",
        PAPER[t.theme],
      );
      stroke.setAttribute("d", curveToSvgPath(geometry.stroke));
      stroke.setAttribute("stroke", BOUNDARY[t.theme]);
      stroke.style.opacity = String(Math.sin(t.phase * Math.PI) * 0.82);
      let echoGeometry: ReturnType<typeof evaluateRemotePortalGeometry> | null =
        null;
      if (t.kind === "remote" || t.kind === "axis") {
        echoGeometry = evaluateRemotePortalGeometry(
          clamp(t.phase - 0.055, 0, 1),
          s.viewport,
        );
        echo.setAttribute("d", curveToSvgPath(echoGeometry.stroke));
        echo.setAttribute("stroke", BOUNDARY[t.sourceTheme]);
        echo.style.opacity = String(Math.sin(t.phase * Math.PI) * 0.26);
      } else {
        echo.style.opacity = "0";
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
      this.currentFrame.masks.push(mask);
      const portalFrame: PortalFrame = {
        visible: true,
        opacity: portalAlpha,
        fill: PAPER[t.theme],
        maskId: mask.id,
        stroke: {
          path: geometry.stroke,
          color: BOUNDARY[t.theme],
          opacity: Math.sin(t.phase * Math.PI) * 0.82,
          width: 1.1 * s.camera.z,
        },
        echo:
          echoGeometry &&
          (t.kind === "remote" || t.kind === "axis")
            ? {
                path: echoGeometry.stroke,
                color: BOUNDARY[t.sourceTheme],
                opacity: Math.sin(t.phase * Math.PI) * 0.26,
                width: 1.0 * s.camera.z,
              }
            : undefined,
      };
      this.currentFrame.portal = portalFrame;
    } else {
      portal.setAttribute("visibility", "hidden");
      stroke.style.opacity = "0";
      echo.style.opacity = "0";
      this.currentFrame.portal = null;
    }
    this.currentFrame.layers.push(
      sceneLayer("portal", 10),
      sceneLayer("background", 20),
      sceneLayer("labels", 50),
      sceneLayer("reading", 60),
    );
    this.appendLoadingFrame();
    this.currentFrame.layers.sort((a, b) => a.order - b.order);
    this.refreshBackgroundFrame(s);
    if (this.resolvedKind === "svg" && this.currentFrame.background)
      this.renderSvgBackground(this.currentFrame.background);
    this.currentFrame.rendererKind = this.resolvedKind;
    if (this.gpu) {
      const dpr =
        this.options.dpr ??
        (typeof window !== "undefined" && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1);
      this.gpu.resize(s.viewport.width, s.viewport.height, dpr);
      this.gpu.render(this.currentFrame);
    }
    requireElement<HTMLElement>(this.host, "#descBar").textContent =
      s.description;
  }

  private refreshBackgroundFrame(s: FieldState): void {
    if (!this.options.background) {
      this.currentFrame.background = null;
      return;
    }
    const quiet = this.readingBounds
      ? {
          x:
            (this.readingBounds.left + this.readingBounds.width / 2 -
              s.viewport.width / 2) /
              s.camera.z,
          y:
            (this.readingBounds.top + this.readingBounds.height / 2 -
              s.viewport.height / 2) /
              s.camera.z,
        }
      : undefined;
    // Convert the screen-space reading centre back to a world quiet zone.
    const worldQuiet = quiet
      ? {
          x:
            s.camera.x +
            (quiet.x * Math.cos((-s.camera.rotation * Math.PI) / 180) -
              quiet.y * Math.sin((-s.camera.rotation * Math.PI) / 180)),
          y:
            s.camera.y +
            (quiet.x * Math.sin((-s.camera.rotation * Math.PI) / 180) +
              quiet.y * Math.cos((-s.camera.rotation * Math.PI) / 180)),
        }
      : undefined;
    const visualTheme =
      s.passage && s.passage.phase >= 0.5 ? s.passage.theme : s.theme;
    const bucket = Math.floor(s.elapsed / 40);
    const key = JSON.stringify([
      s.settings.background,
      visualTheme,
      s.camera.x.toFixed(2),
      s.camera.y.toFixed(2),
      s.camera.z.toFixed(4),
      s.camera.rotation.toFixed(2),
      s.viewport.width,
      s.viewport.height,
      bucket,
      s.settings.reducedMotion,
      s.loading,
      s.overview,
      worldQuiet,
    ]);
    if (key === this.backgroundCacheKey && this.backgroundCache) {
      this.currentFrame.background = this.backgroundCache;
      return;
    }
    this.backgroundCacheKey = key;
    this.backgroundCache = evaluateBackgroundFrame({
      mode: s.settings.background,
      camera: s.camera,
      viewport: s.viewport,
      elapsed: s.elapsed,
      theme: visualTheme,
      reduced: s.settings.reducedMotion,
      loading: s.loading,
      overview: s.overview,
      quiet: worldQuiet,
    });
    this.currentFrame.background = this.backgroundCache;
  }
  private createInlineIconSvg(token: IconToken, _hubMorph = 0): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(ns, "svg");
    svgEl.setAttribute("class", "inline-svg-icon");
    svgEl.setAttribute("viewBox", token.viewBox);
    svgEl.setAttribute("width", "15");
    svgEl.setAttribute("height", "15");
    svgEl.setAttribute("aria-hidden", "true");
    svgEl.setAttribute("fill", "none");
    svgEl.setAttribute("stroke", "currentColor");
    svgEl.setAttribute("stroke-linecap", "round");
    svgEl.setAttribute("stroke-linejoin", "round");
    const g = document.createElementNS(ns, "g");
    populateIconGlyph(g, token);
    svgEl.append(g);
    return svgEl;
  }
  private buildIconShowcase(_hub: Hub): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "icon-showcase-grid";
    for (const token of Object.values(ICON_TOKENS)) {
      const card = document.createElement("div");
      card.className = "icon-showcase-card";
      card.append(this.createInlineIconSvg(token));
      const label = document.createElement("span");
      label.textContent = token.label;
      card.append(label);
      grid.append(card);
    }
    return grid;
  }
  private articleFor(id: string): HTMLElement {
    let article = this.articles.get(id);
    if (!article) {
      article = this.host.ownerDocument.createElement("article");
      article.className = "note";
      article.id = `text-${id}`;
      article.hidden = true;
      this.reading.append(article);
    }
    this.articles.delete(id);
    this.articles.set(id, article);
    return article;
  }

  private trimArticles(visible: Set<string>): void {
    const inactive = [...this.articles].filter(([id]) => !visible.has(id));
    let excess = inactive.length - 8;
    const selection = this.host.ownerDocument.getSelection?.();
    const focused = this.host.ownerDocument.activeElement;
    for (const [id, article] of inactive) {
      if (excess <= 0) break;
      if ((focused && article.contains(focused)) ||
          (selection?.anchorNode && article.contains(selection.anchorNode)) ||
          (selection?.focusNode && article.contains(selection.focusNode))) continue;
      this.articleRenderer.releaseArticle(article);
      article.remove();
      this.articles.delete(id);
      excess--;
    }
  }

  private renderTexts(s: FieldState) {
    this.readingBounds = null;
    const hub = s.hubs[s.focus],
      nodes = this.catalog.siblings(this.selected(hub).id, s.searchResults),
      morph = ease(clamp(hub.morph, 0, 1));
    const p = s.passage?.phase,
      fold = p === undefined ? 1 : readingEnvelope(p),
      contentTurn = s.contentTurn?.hub === hub.id ? s.contentTurn : null,
      page = contentTurn
        ? pageTurnPose(
            contentTurn.phase,
            s.settings.reducedMotion,
            contentTurn.direction,
          )
        : null,
      expressionOpacity = page ? page.opacity : morphReadingEnvelope(hub.morph);
    const visible = new Set<string>();
    if (!s.overview && !s.loading)
      nodes.forEach((node, i) => {
        const surface =
          ease(clamp(1 - Math.abs(i - hub.scroll) / s.settings.range, 0, 1)) *
          fold *
          expressionOpacity;
        if (surface < 0.015) return;
        const article = this.articleFor(node.id),
          depth = 1 - surface,
          presentation = morph > 0.5 ? "line" : "circle";
        this.articleRenderer.syncArticle(article, node, hub, presentation);
        if (node.id === this.catalog.searchRoot) {
          const input = article.querySelector<HTMLInputElement>(
            "input.hub-search-input",
          );
          if (
            input &&
            this.host.ownerDocument.activeElement !== input &&
            input.value !== s.searchQuery
          ) {
            input.value = s.searchQuery;
          }
          const status = article.querySelector<HTMLElement>(".search-status");
          if (status) {
            const count = Math.max(0, nodes.length - 1);
            const nextText = s.searchQuery.trim()
              ? `已实时生成 ${count} 个周界标签 · 在空白处滚动或点击圆周标签检视`
              : `已挂载 ${count} 个推荐周界标签 · 输入时焦点恒定不中断`;
            if (status.textContent !== nextText) status.textContent = nextText;
          }
        }
        for (const button of article.querySelectorAll<HTMLButtonElement>(
          'button[data-target^="act:"]',
        )) {
          const pressed = isActionPressed(
            button.dataset.target!.slice(4),
            s.settings,
            s.theme,
          );
          if (pressed === undefined) continue;
          const selected = String(pressed);
          if (button.getAttribute("aria-pressed") !== selected)
            button.setAttribute("aria-pressed", selected);
        }
        visible.add(node.id);
        if (article.hidden) article.hidden = false;
        const inert = !!s.passage || !!page || surface < 0.55;
        if (Boolean(article.inert) !== inert) article.inert = inert;
        const ariaHidden = String(inert);
        if (article.getAttribute("aria-hidden") !== ariaHidden)
          article.setAttribute("aria-hidden", ariaHidden);
        const position = nodeS(hub, i, nodes.length, s.camera, s.viewport);
        // Typography stays upright while its reading window follows the outward normal.
        const anchorPt = hubToScreen(
          hub,
          material(hub, position, 76),
          s.camera,
          s.viewport,
        );
        const normal = rot(
          outwardNormal(hub, position),
          (s.camera.rotation * Math.PI) / 180,
        );
        const isLong = article.classList.contains("is-long");
        const widthPx = readingWidth(s.viewport, isLong);
        const widthStr = `${widthPx.toFixed(1)}px`;
        if (article.style.width !== widthStr) article.style.width = widthStr;
        const heightKey = JSON.stringify([node.id, presentation, widthStr]);
        let height = this.heights.get(heightKey);
        if (height === undefined) {
          const preparedHeight = this.articleRenderer.estimateArticleHeight(article, node, presentation, widthPx);
          height = article.querySelector<HTMLElement>(".note-content")!.offsetHeight || preparedHeight;
          this.heights.set(heightKey, height);
        }
        const panelHeight = Math.min(
          height,
          readingHeight(s.viewport, s.camera.z, normal.y),
        );
        const panelHeightStr = `${panelHeight.toFixed(1)}px`;
        if (article.style.height !== panelHeightStr)
          article.style.height = panelHeightStr;
        const maxFloat = Math.max(0, height - panelHeight);
        const maxFloatStr = String(Math.round(maxFloat));
        if (article.dataset.maxFloat !== maxFloatStr)
          article.dataset.maxFloat = maxFloatStr;
        const activeFloat =
          Math.abs(i - hub.scroll) < 0.6
            ? clamp(hub.textOffset, 0, maxFloat)
            : 0;
        const content = article.querySelector<HTMLElement>(".note-content")!;
        const floatTransform = `translateY(${-activeFloat.toFixed(2)}px)`;
        if (content.style.transform !== floatTransform)
          content.style.transform = floatTransform;
        const placement = placeReading(
          anchorPt,
          normal,
          widthPx,
          panelHeight,
          s.camera.z,
        );
        const clearancePx = computeHubVerticalClearance(
          hub,
          placement,
          widthPx,
          panelHeight,
          normal,
          s.camera,
          s.viewport,
        );
        const clip = resolveReadingClip(
          normal,
          height,
          panelHeight,
          activeFloat,
          clearancePx,
        );
        const windowEl = article.querySelector<HTMLElement>(".note-window")!;
        if (article.dataset.clipEdge !== clip.edge)
          article.dataset.clipEdge = clip.edge;
        const fadeState = clip.fadePx > 0.5 ? clip.edge : "none";
        if (windowEl.dataset.clipFade !== fadeState)
          windowEl.dataset.clipFade = fadeState;
        const winMarginTop = `${clip.windowMarginTop.toFixed(1)}px`;
        if (windowEl.style.marginTop !== winMarginTop)
          windowEl.style.marginTop = winMarginTop;
        const winPaddingTop = `${clip.windowPaddingTop.toFixed(1)}px`;
        if (windowEl.style.paddingTop !== winPaddingTop)
          windowEl.style.paddingTop = winPaddingTop;
        const winHeight = `${clip.windowHeight.toFixed(1)}px`;
        if (windowEl.style.height !== winHeight)
          windowEl.style.height = winHeight;
        if (windowEl.dataset.maskSpec !== clip.maskImage) {
          windowEl.dataset.maskSpec = clip.maskImage;
          windowEl.style.maskImage = clip.maskImage;
          windowEl.style.webkitMaskImage = clip.maskImage;
        }
        if (article.dataset.side !== placement.side)
          article.dataset.side = placement.side;
        const anchorVarStr = `${placement.originY.toFixed(1)}px`;
        if (article.style.getPropertyValue("--anchor-y") !== anchorVarStr)
          article.style.setProperty("--anchor-y", anchorVarStr);
        const originStr = `${placement.originX.toFixed(3)}px ${placement.originY.toFixed(3)}px`;
        if (article.style.transformOrigin !== originStr)
          article.style.transformOrigin = originStr;
        const targetLeft = placement.left + 18 * depth * s.camera.z;
        const targetTop = placement.top + 32 * depth * s.camera.z;
        const turnY = page?.angle ?? 0;
        const transformStr = `translate3d(${(targetLeft + (s.camera.z - 1) * placement.originX).toFixed(2)}px,${(targetTop + (s.camera.z - 1) * placement.originY).toFixed(2)}px,0) scale(${s.camera.z}) rotateY(${turnY.toFixed(2)}deg)`;
        if (article.style.transform !== transformStr)
          article.style.transform = transformStr;
        if (node.id === this.selected(hub).id)
          this.readingBounds = {
            left: targetLeft,
            top: targetTop,
            width: widthPx * s.camera.z,
            height: panelHeight * s.camera.z,
          };
        const blur = 8.5 * depth ** 1.12 * s.settings.blur;
        const filterStr =
          s.settings.reducedMotion || blur < 0.08 ? "none" : `blur(${blur}px)`;
        if (article.style.filter !== filterStr)
          article.style.filter = filterStr;
        const opacityStr = String(surface ** 1.2);
        if (article.style.opacity !== opacityStr)
          article.style.opacity = opacityStr;
        const pointerStr = inert ? "none" : "auto";
        if (article.style.pointerEvents !== pointerStr)
          article.style.pointerEvents = pointerStr;
        this.currentFrame.reading.push({
          id: `reading:${node.id}`,
          chapterId: node.id,
          hubId: hub.id,
          presentation,
          visible: true,
          inert,
          left: targetLeft,
          top: targetTop,
          width: widthPx * s.camera.z,
          height: panelHeight * s.camera.z,
          scale: s.camera.z,
          opacity: surface ** 1.2,
          blur: s.settings.reducedMotion ? 0 : blur,
          rotationY: turnY,
          transformOrigin: {
            x: placement.originX,
            y: placement.originY,
          },
          anchorY: placement.originY,
          side: placement.side,
          clipEdge: clip.edge,
          maskImage: clip.maskImage,
          textOffset: activeFloat,
          maxFloat,
          pointerEvents: inert ? "none" : "auto",
        });
      });
    for (const [id, article] of this.articles)
      if (!visible.has(id)) {
        if (!article.hidden) article.hidden = true;
        if (!article.inert) article.inert = true;
        if (article.getAttribute("aria-hidden") !== "true")
          article.setAttribute("aria-hidden", "true");
      }
    this.trimArticles(visible);
  }
  destroy() {
    this.destroyed = true;
    this.gpu?.destroy();
    this.gpu = null;
    this.localLabelTurns.clear();
    this.geometry.replaceChildren();
    this.labels.replaceChildren();
    this.backgroundRoot.replaceChildren();
    this.loadingRoot.remove();
    this.flowPaths = [];
    this.flowMarkers = [];
    this.starPoints = [];
    this.starTrails = [];
    this.meteorPaths = [];
    this.meteorHeads = [];
    for (const article of this.articles.values()) this.articleRenderer.releaseArticle(article);
    this.articles.clear();
    this.reading.replaceChildren();
    this.hudControls.remove();
    this.actions.clear();
    delete this.host.dataset.renderer;
    this.currentFrame = emptySceneFrame(
      this.resolvedKind,
      { width: 0, height: 0 },
      { x: 0, y: 0, z: 1, rotation: 0 },
      "light",
    );
  }
}
