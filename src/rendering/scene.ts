import { HoverFeedback } from "../core/hover-feedback.ts";
import type { HoverChannel } from "../core/hover-feedback.ts";
import { buildSceneFrame, symbolActivity } from "../geometry/scene-frame.ts";
import { SemanticLabels } from "./semantic-labels.ts";
import type { LoadingGeometry } from "../geometry/loading.ts";
import { loadingShapes } from "../geometry/loading.ts";
import { loadingToneColor } from "./loading.ts";
import { bindSemanticFeedback } from "./semantic-feedback.ts";
import type { SymbolInteractionState } from "./semantic-feedback.ts";
export type { SymbolInteractionState } from "./semantic-feedback.ts";
import { ReadingLayer } from "./reading-layer.ts";
import type { ReadingCorrection } from "./reading-positions.ts";
import type { ArticleRenderer } from "./article.ts";
import { LocalLabelTurns } from "./local-labels.ts";
import type {
  Command,
  FieldState,
  GraspReadingSnapshot,
  Hub,
  Theme,
  Vec,
} from "../core/types.ts";
import { BOUNDARY } from "../core/palette.ts";
import { ICON_TOKENS, resolveIconToken } from "../core/icons.ts";
import type { IconToken } from "../core/icons.ts";
import type { SymbolKind } from "../core/symbol-morph.ts";
import { Catalog } from "../content/catalog.ts";
import { ordinaryAndLocalAttachments } from "../application/attachments.ts";
import { populateIconGlyph } from "./svg-symbols.ts";
export { renderSymbolGeometryToGroup } from "./svg-symbols.ts";
import { requireElement } from "./dom.ts";
import type {
  BackgroundFrame,
  GraphicsOptions,
  HitRegion,
  ResolvedRendererKind,
  SceneFrame,
} from "../core/graphics.ts";
import { emptySceneFrame, hitTestFrame, sceneLayer } from "../core/graphics.ts";
import { evaluateBackgroundFrame } from "./graphics/background.ts";
import { PixiGraphicsRenderer } from "./graphics/pixi-renderer.ts";
import { SvgGraphicsRenderer } from "./graphics/svg-renderer.ts";

/** Camera zoom threshold below which focused hub global tags yield to the traditional HUD bar. */
export { TRADITIONAL_HUD_ZOOM_THRESHOLD } from "../geometry/scene-frame.ts";

export class Scene {
  private root: SVGSVGElement;
  private geometry: SVGGElement;
  private labels: SVGGElement;
  private readonly semanticLabels: SemanticLabels;
  private reading: HTMLElement;
  private hudControls: HTMLElement;
  private readonly readingLayer: ReadingLayer;
  get readingBounds() {
    return this.readingLayer.readingBounds;
  }
  get readingPositions() {
    return this.readingLayer.readingPositions;
  }
  get articleRenderer(): ArticleRenderer {
    return this.readingLayer.articleRenderer;
  }
  readonly actions = new Map<string, Command>();
  private lastRenderKey = "";
  private readonly localLabelTurns = new LocalLabelTurns();
  private disposeFeedback: () => void = () => {};
  private symbolFeedback = new Map<string, SymbolInteractionState>();
  private readonly hoverFeedback = new HoverFeedback();
  private get hoveredTarget(): string | null { return this.hoverFeedback.target; }
  private readonly options: Required<
    Pick<GraphicsOptions, "renderer" | "background">
  > & { dpr?: number };
  private resolvedKind: ResolvedRendererKind = "svg";
  private gpu: PixiGraphicsRenderer | null = null;
  private readonly svgRenderer: SvgGraphicsRenderer;
  private initPromise: Promise<void> | null = null;
  private destroyed = false;
  private frameRevision = 0;
  private currentFrame: SceneFrame;
  private backgroundCacheKey = "";
  private backgroundCache: BackgroundFrame | null = null;
  private loadingGeometry: LoadingGeometry | null = null;
  private contentRevision = 0;
  private readonly amberColors = new Map<Theme, string>();

  setLoadingGeometry(geometry: LoadingGeometry | null): void {
    this.loadingGeometry = geometry;
  }

  invalidateContent(ids: readonly string[]): void {
    this.contentRevision++;
    this.readingLayer.invalidateContent(ids);
  }

  private appendLoadingFrame(): void {
    const geometry = this.loadingGeometry;
    if (!geometry) return;
    const primitives: import("../core/graphics.ts").ScenePrimitive[] =
      loadingShapes(geometry).map((shape) => {
        const style = {
          stroke: loadingToneColor(geometry.theme, shape.tone),
          strokeWidth: shape.weight,
          opacity: shape.opacity,
        };
        if (shape.kind === "circle")
          return {
            type: "circle",
            cx: shape.cx,
            cy: shape.cy,
            radius: shape.r,
            ...style,
          };
        if (shape.kind === "arc")
          return {
            type: "arc",
            cx: shape.cx,
            cy: shape.cy,
            radius: shape.r,
            startAngle: shape.startAngle,
            endAngle: shape.endAngle,
            anticlockwise: !shape.clockwise,
            ...style,
          };
        return {
          type: "polyline",
          points: shape.points,
          closed: shape.closed,
          ...style,
        };
      });
    this.currentFrame.layers.push(sceneLayer("loading", 70, primitives));
  }

  private retainedReading: GraspReadingSnapshot | null = null;
  setRetainedReading(view: GraspReadingSnapshot | null): void {
    if (this.retainedReading === view) return;
    this.retainedReading = view;
    this.readingLayer.setRetainedChapter(view);
    this.lastRenderKey = "";
  }
  prepareContent(id: string, presentation: "circle" | "line"): boolean {
    return this.readingLayer.prepareContent(id, presentation);
  }
  takeReadingCorrections(): ReadingCorrection[] {
    return this.readingLayer.takeReadingCorrections();
  }
  invalidateLayout(fontsChanged = false): void {
    this.readingLayer.invalidateLayout(fontsChanged);
    if (fontsChanged) this.gpu?.invalidateGlyphs("font");
    this.lastRenderKey = "";
  }

  get isAnimating(): boolean {
    return (
      this.lastRenderKey === "" ||
      this.readingLayer.isSettling ||
      this.localLabelTurns.isAnimating
    );
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
    if (this.destroyed) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this.initializeRenderer();
    }
    return this.initPromise;
  }

  private async initializeRenderer(): Promise<void> {
    if (this.options.renderer === "svg") {
      this.resolvedKind = "svg";
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
      if (gpu.isLost || this.options.renderer === "auto" && gpu.device.software === true) {
        if (gpu.device.software === true) this.host.dataset.rendererFallback = "software";
        gpu.destroy();
        this.installSvgFallback();
        return;
      }
      this.gpu = gpu;
      this.resolvedKind = "webgl";
      this.reading.before(gpu.canvas);
      this.lastRenderKey = "";
    } catch {
      this.installSvgFallback();
    }
  }

  private installSvgFallback(): void {
    if (this.destroyed) return;
    if (this.resolvedKind === "svg" && !this.gpu) {
      return;
    }
    this.resolvedKind = "svg";
    this.gpu?.destroy();
    this.gpu = null;
    this.lastRenderKey = "";
  }

  private host: HTMLElement;
  private catalog: Catalog;
  constructor(
    host: HTMLElement,
    catalog: Catalog,
    options: GraphicsOptions = {},
  ) {
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
    this.geometry = requireElement(host, "#gGeometry");
    this.labels = requireElement(host, "#gLabels");
    this.semanticLabels = new SemanticLabels(this.labels);
    this.reading = requireElement(host, "#reading");
    this.readingLayer = new ReadingLayer(host, catalog, {
      inlineIcon: (token, morph) => this.createInlineIconSvg(token, morph),
      iconShowcase: (hub) => this.buildIconShowcase(hub),
    });
    this.hudControls = this.ensureHudControls(host);
    this.svgRenderer = new SvgGraphicsRenderer(this.root);
    this.host.dataset.numericGraphics = "true";
    this.disposeFeedback = bindSemanticFeedback({
      labels: this.labels,
      reading: this.reading,
      geometry: this.geometry,
      resolve: (key) => this.actions.get(key),
      symbol: (key, patch) => this.setSymbolInteraction(key, patch),
      hover: (target, channel, previous) => this.setHoveredTarget(target, channel, previous),
    });
    if (
      this.options.renderer !== "svg" &&
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      window.document === document
    ) {
      void this.initialize();
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

  setHoveredTarget(target: string | null, channel: HoverChannel = "pointer", previous?: string | null) {
    const before = this.hoverFeedback.target;
    this.hoverFeedback.set(target, channel, previous);
    if (before !== this.hoverFeedback.target) this.lastRenderKey = "";
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
    this.lastRenderKey = "";
  }

  getSymbolActivity(
    commandKey: string,
    kind: SymbolKind,
    s?: FieldState | null,
  ): number {
    return symbolActivity(this.symbolFeedback.get(commandKey), kind, s);
  }

  private selected(hub: Hub) {
    return this.catalog.get(hub.path.at(-1)!);
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
    if (this.destroyed) return;
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
    if (key === this.lastRenderKey && !this.readingLayer.isSettling) {
      this.refreshBackgroundFrame(s);
      if (this.gpu) this.gpu.render(this.currentFrame);
      else this.svgRenderer.render(this.currentFrame);
      if (this.host.dataset.renderer !== this.resolvedKind) this.host.dataset.renderer = this.resolvedKind;
      return;
    }
    this.lastRenderKey = key;
    const visualTheme =
      s.passage && s.passage.phase >= 0.5 ? s.passage.theme : s.theme;
    this.host.ownerDocument.documentElement.dataset.theme = visualTheme;
    if (!this.amberColors.has(visualTheme)) {
      const color = this.host.ownerDocument.defaultView
        ?.getComputedStyle(this.host.ownerDocument.documentElement)
        .getPropertyValue("--amber")
        .trim();
      this.amberColors.set(visualTheme, color || BOUNDARY[visualTheme]);
    }
    const built = buildSceneFrame(s, this.catalog, {
      renderer: this.resolvedKind,
      revision: ++this.frameRevision,
      relationColor: this.amberColors.get(visualTheme)!,
      focusedEntries,
      locals,
      feedback: this.symbolFeedback,
      hoveredTarget: this.hoveredTarget,
    });
    this.currentFrame = built.frame;
    this.host.style.setProperty("--camera-scale", String(s.camera.z));
    this.root.setAttribute(
      "viewBox",
      `0 0 ${s.viewport.width} ${s.viewport.height}`,
    );
    this.host.dataset.discoveryStage = built.perception.stage;
    if (built.perception.resonatingHubId)
      this.host.dataset.resonatingHub = built.perception.resonatingHubId;
    else delete this.host.dataset.resonatingHub;
    const passage = s.passage;
    if (passage) {
      this.host.dataset.transition = "passage";
      this.host.dataset.transitionKind = passage.kind;
      this.host.dataset.direction = passage.direction;
    } else {
      delete this.host.dataset.transition;
      delete this.host.dataset.transitionKind;
      delete this.host.dataset.direction;
    }
    this.actions.clear();
    for (const hit of this.currentFrame.hitRegions)
      this.actions.set(hit.id, hit.command);
    this.updateHudControls(s, built.useTraditionalHud);
    this.currentFrame.reading = this.readingLayer.render(s);
    this.semanticLabels.render(this.currentFrame.labels);
    this.labels.style.pointerEvents =
      this.resolvedKind === "webgl" || s.passage ? "none" : "";
    this.appendLoadingFrame();
    this.currentFrame.layers.sort((a, b) => a.order - b.order);
    this.refreshBackgroundFrame(s);

    this.currentFrame.rendererKind = this.resolvedKind;
    if (this.gpu) {
      const dpr =
        this.options.dpr ??
        (typeof window !== "undefined" && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1);
      this.gpu.resize(s.viewport.width, s.viewport.height, dpr);
      this.gpu.render(this.currentFrame);
    } else this.svgRenderer.render(this.currentFrame);
    if (this.host.dataset.renderer !== this.resolvedKind) this.host.dataset.renderer = this.resolvedKind;
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
            (this.readingBounds.left +
              this.readingBounds.width / 2 -
              s.viewport.width / 2) /
            s.camera.z,
          y:
            (this.readingBounds.top +
              this.readingBounds.height / 2 -
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
    const bucket =
      s.settings.background === "none" || s.settings.reducedMotion
        ? 0
        : Math.floor(s.elapsed / 40);
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

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disposeFeedback();
    this.hoverFeedback.clear();
    this.svgRenderer.destroy();
    delete this.host.dataset.numericGraphics;
    this.gpu?.destroy();
    this.gpu = null;
    this.localLabelTurns.clear();
    this.geometry.replaceChildren();
    this.semanticLabels.destroy();
    this.readingLayer.destroy();
    this.hudControls.remove();
    this.actions.clear();
    delete this.host.dataset.renderer;
    delete this.host.dataset.rendererFallback;
    this.currentFrame = emptySceneFrame(
      this.resolvedKind,
      { width: 0, height: 0 },
      { x: 0, y: 0, z: 1, rotation: 0 },
      "light",
    );
  }
}
