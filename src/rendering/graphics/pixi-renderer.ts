import type {
  ArcPrimitive,
  CirclePrimitive,
  PolylinePrimitive,
  RectPrimitive,
  SceneFrame,
  ScenePrimitive,
  TextPrimitive,
} from "../../core/graphics.ts";
import type { Theme, Vec } from "../../core/types.ts";
import { GpuGlyphCache, IconGeometryCache } from "./glyph-cache.ts";

type PixiModule = typeof import("pixi.js");
type PixiContainer = InstanceType<PixiModule["Container"]>;
type PixiGraphics = InstanceType<PixiModule["Graphics"]>;
type PixiText = InstanceType<PixiModule["Text"]>;
type PixiRenderer = Awaited<ReturnType<PixiModule["autoDetectRenderer"]>>;

const CSS_COLORS: Record<Theme, Record<string, string>> = {
  light: {
    ink: "#233532",
    quiet: "#5e726c",
    line: "#256b63",
    amber: "#986632",
    paper: "#f5f6f2",
    label: "#233532",
    stem: "#8fa99e",
  },
  parchment: {
    ink: "#38251a",
    quiet: "#7d6250",
    line: "#a64b2a",
    amber: "#b05a2b",
    paper: "#f6efe4",
    label: "#38251a",
    stem: "#b08d74",
  },
  celadon: {
    ink: "#1c3340",
    quiet: "#5c7888",
    line: "#245c78",
    amber: "#9c6430",
    paper: "#eaf2f3",
    label: "#1c3340",
    stem: "#7ea1b0",
  },
  rosewood: {
    ink: "#361f2d",
    quiet: "#785c6d",
    line: "#783a59",
    amber: "#9e642e",
    paper: "#f3edf1",
    label: "#361f2d",
    stem: "#a68497",
  },
  ivory: {
    ink: "#1f2b46",
    quiet: "#617091",
    line: "#344e86",
    amber: "#9a6228",
    paper: "#eef0f6",
    label: "#1f2b46",
    stem: "#8796b8",
  },
  dark: {
    ink: "#ebf0ea",
    quiet: "#93aaa1",
    line: "#88cec0",
    amber: "#e7b879",
    paper: "#10191b",
    label: "#ebf0ea",
    stem: "#5a7974",
  },
  obsidian: {
    ink: "#f2f3f1",
    quiet: "#9da5a2",
    line: "#949a9e",
    amber: "#bca789",
    paper: "#0c0e10",
    label: "#f2f3f1",
    stem: "#6c7377",
  },
  abyss: {
    ink: "#e8eef9",
    quiet: "#899ec2",
    line: "#82b4f5",
    amber: "#e8ba78",
    paper: "#0d1424",
    label: "#e8eef9",
    stem: "#55709e",
  },
};

function palette(theme: Theme) {
  return CSS_COLORS[theme] ?? CSS_COLORS.light;
}

function colorFrom(value: string | undefined, fallback: string): string {
  return value && value !== "none" ? value : fallback;
}

export interface PixiRendererOptions {
  dpr?: number;
  onContextLost?: () => void;
}

export class PixiGraphicsRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly kind = "webgl" as const;
  private readonly pixi: PixiModule;
  private readonly renderer: PixiRenderer;
  private readonly stage: PixiContainer;
  private readonly layerRoots = new Map<string, PixiContainer>();
  private readonly containers = new Map<string, PixiContainer>();
  private readonly graphicsPools = new Map<PixiContainer, PixiGraphics[]>();
  private graphicsCursors = new Map<PixiContainer, number>();
  private textCursors = new Map<PixiContainer, number>();
  private parentIds = new WeakMap<PixiContainer, number>();
  private nextParentId = 0;
  private readonly glyphs = new GpuGlyphCache<PixiText>((text) => text.destroy());
  private lastFrame: SceneFrame | null = null;
  private lastRevision = -1;
  private lastBackground: SceneFrame["background"] = null;
  private renderWidth = 0;
  private renderHeight = 0;
  private readonly primitiveSignatures = new WeakMap<PixiGraphics, string>();
  private readonly icons = new IconGeometryCache();
  private fontFamily: string;
  private fontSymbol = "serif";
  private paletteTheme: Theme | null = null;
  private dpr: number;
  private destroyed = false;
  private lost = false;

  private constructor(
    pixi: PixiModule,
    renderer: PixiRenderer,
    fontFamily: string,
    dpr: number,
    onContextLost?: () => void,
  ) {
    this.pixi = pixi;
    this.renderer = renderer;
    this.canvas = renderer.canvas as HTMLCanvasElement;
    this.fontFamily = fontFamily;
    this.dpr = dpr;
    this.stage = new pixi.Container();
    this.stage.sortableChildren = true;
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "0";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.dataset.renderer = "webgl";
    this.canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        this.lost = true;
        onContextLost?.();
      },
      { once: true },
    );
  }

  static async create(
    options: PixiRendererOptions = {},
  ): Promise<PixiGraphicsRenderer> {
    const pixi = await import("pixi.js");
    const dpr =
      options.dpr ??
      (typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1);
    const renderer = await pixi.autoDetectRenderer({
      preference: ["webgl"],
      width: 1,
      height: 1,
      resolution: dpr,
      autoDensity: true,
      antialias: true,
      backgroundAlpha: 0,
      powerPreference: "high-performance",
    });
    const family =
      typeof document !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue(
            "--font-sans",
          ) || "Inter, sans-serif"
        : "Inter, sans-serif";
    return new PixiGraphicsRenderer(
      pixi,
      renderer,
      family,
      dpr,
      options.onContextLost,
    );
  }

  get isLost(): boolean {
    return this.lost;
  }

  /** Invalidate text/icon caches after a theme, DPR or font change. */
  invalidateGlyphs(reason: "theme" | "dpr" | "font" | "manual" = "manual"): void {
    this.lastFrame = null;
    if (reason === "font") this.paletteTheme = null;
    this.glyphs.clear(reason);
    if (
      reason === "font" &&
      typeof document !== "undefined" &&
      typeof getComputedStyle === "function"
    ) {
      this.fontFamily =
        getComputedStyle(document.documentElement).getPropertyValue(
          "--font-sans",
        ) || this.fontFamily;
    }
  }

  resize(width: number, height: number, dpr = this.dpr): void {
    if (this.destroyed || this.lost) return;
    if (width === this.renderWidth && height === this.renderHeight && dpr === this.dpr) return;
    this.renderWidth = width;
    this.renderHeight = height;
    this.lastFrame = null;
    this.dpr = dpr;
    this.renderer.resize(
      Math.max(1, Math.round(width)),
      Math.max(1, Math.round(height)),
      dpr,
    );
  }

  render(frame: SceneFrame): void {
    if (this.destroyed || this.lost) return;
    if (this.lastFrame === frame && this.lastRevision === frame.revision) {
      if (this.lastBackground === frame.background) return;
      this.graphicsCursors.clear();
      this.drawBackground(frame, false);
      this.lastBackground = frame.background;
      this.stage.sortChildren();
      this.renderer.render(this.stage);
      return;
    }
    this.lastFrame = frame;
    this.lastRevision = frame.revision;
    this.lastBackground = frame.background;
    if (this.paletteTheme !== frame.visualTheme) {
      const style = getComputedStyle(document.documentElement);
      const colors = CSS_COLORS[frame.visualTheme];
      for (const key of ["ink", "quiet", "line", "amber", "paper", "stem", "accent"])
        colors[key] = style.getPropertyValue(`--${key}`).trim() || colors[key];
      colors.stemNav = style.getPropertyValue("--stem-nav").trim() || colors.stem;
      this.fontSymbol = style.getPropertyValue("--font-symbol").trim() || this.fontSymbol;
      this.paletteTheme = frame.visualTheme;
    }
    this.glyphs.setEnvironment({
      theme: frame.visualTheme,
      dpr: this.dpr,
      fontFamily: this.fontFamily,
    });
    for (const text of this.glyphs.items()) text.visible = false;
    for (const container of this.containers.values()) container.visible = false;
    for (const pool of this.graphicsPools.values()) for (const graphics of pool) graphics.visible = false;
    this.graphicsCursors.clear();
    this.textCursors.clear();
    const ordered = [...frame.layers].sort((a, b) => a.order - b.order);
    const addLayer = (id: string, primitives: SceneFrame["layers"][number]["primitives"]) => {
      const root = this.container(`layer:${id}`, this.stage);
      root.label = id;
      root.zIndex = frame.layers.find(layer => layer.id === id)?.order ?? 0;
      this.layerRoots.set(id, root);
      this.stage.addChild(root);
      for (const primitive of primitives) {
        if (primitive.type === "text")
          this.drawText(root, primitive, frame);
        else this.drawPrimitive(root, primitive, frame);
      }
    };
    for (const layer of ordered)
      if (layer.id === "base") addLayer(layer.id, layer.primitives);
    this.drawPortalFill(frame);
    this.drawBackground(frame);
    for (const layer of ordered)
      if (layer.id !== "base" && layer.id !== "labels" && layer.id !== "reading")
        addLayer(layer.id, layer.primitives);
    this.drawPortalStrokes(frame);
    this.drawLabels(frame);
    this.stage.sortChildren();
    this.renderer.render(this.stage);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.glyphs.clear("manual");
    this.stage.destroy({ children: true });
    this.containers.clear();
    this.graphicsPools.clear();
    try {
      this.renderer.destroy();
    } catch {
      /* A failed context teardown must not block SVG fallback. */
    }
    this.canvas.remove();
  }

  private container(key: string, parent: PixiContainer): PixiContainer {
    let container = this.containers.get(key);
    if (!container) {
      container = new this.pixi.Container();
      container.label = key;
      container.eventMode = "none";
      this.containers.set(key, container);
      parent.addChild(container);
    }
    container.visible = true;
    return container;
  }

  private graphics(parent: PixiContainer, clear = true): PixiGraphics {
    let pool = this.graphicsPools.get(parent);
    if (!pool) { pool = []; this.graphicsPools.set(parent, pool); }
    const index = this.graphicsCursors.get(parent) ?? 0;
    this.graphicsCursors.set(parent, index + 1);
    let graphics = pool[index];
    if (!graphics) {
      graphics = new this.pixi.Graphics();
      graphics.eventMode = "none";
      pool[index] = graphics;
      parent.addChild(graphics);
    }
    if (clear) graphics.clear();
    graphics.visible = true;
    graphics.alpha = 1;
    return graphics;
  }

  private drawBackground(frame: SceneFrame, reorder = true): void {
    const background = frame.background;
    if (!background || background.mode === "none" || background.opacity <= 0)
      return;
    const root = this.container("background", this.stage);
    root.label = "background";
    root.zIndex = frame.layers.find(layer => layer.id === "background")?.order ?? 20;
    root.alpha = background.opacity;
    if (reorder) this.stage.addChild(root);
    const flow = this.graphics(root);
    for (const line of background.streamlines) {
      this.polyline(
        flow,
        line.points,
        colorFrom(palette(background.theme).stem, "#8fa99e"),
        line.width,
        line.opacity,
      );
      flow
        .circle(line.marker.x, line.marker.y, Math.max(0.5, line.markerRadius))
        .fill({
          color: colorFrom(palette(background.theme).stem, "#8fa99e"),
          alpha: line.markerOpacity,
        });
    }
    const stars = this.graphics(root);
    for (const star of background.stars) {
      stars
        .circle(star.at.x, star.at.y, Math.max(0.25, star.radius))
        .fill({ color: star.fill, alpha: star.opacity });
    }
    const trails = this.graphics(root);
    for (const trail of background.trails) {
      trails
        .moveTo(
          trail.center.x + Math.cos(trail.startAngle) * trail.radius,
          trail.center.y + Math.sin(trail.startAngle) * trail.radius,
        )
        .arc(
          trail.center.x,
          trail.center.y,
          trail.radius,
          trail.startAngle,
          trail.endAngle,
        )
        .stroke({
          color: trail.color,
          width: Math.max(0.25, trail.width),
          alpha: trail.opacity,
          cap: "round",
        });
    }
    const meteors = this.graphics(root);
    for (const meteor of background.meteors) {
      meteors
        .moveTo(meteor.from.x, meteor.from.y)
        .lineTo(meteor.to.x, meteor.to.y)
        .stroke({
          color: meteor.color,
          width: Math.max(0.5, meteor.width),
          alpha: meteor.opacity,
          cap: "round",
        });
      meteors
        .circle(meteor.head.x, meteor.head.y, Math.max(0.5, meteor.headRadius))
        .fill({ color: meteor.color, alpha: meteor.opacity });
    }
  }

  private drawPortalFill(frame: SceneFrame): void {
    const portal = frame.portal;
    if (!portal || !portal.visible || portal.opacity <= 0) return;
    const root = this.container("portal", this.stage);
    root.label = "portal";
    root.zIndex = frame.layers.find(layer => layer.id === "portal")?.order ?? 10;
    root.alpha = portal.opacity;
    this.stage.addChild(root);
    const mask = this.container("portal-mask", root);
    for (const maskFrame of frame.masks) {
      if (!maskFrame.visible || maskFrame.id !== portal.maskId) continue;
      const area = this.graphics(mask);
      const outer = maskFrame.outerRect;
      if (outer) {
        area.rect(outer.x, outer.y, outer.width, outer.height).fill({
          color: "#fff",
        });
        // evenodd swept mask: cut the transformed circle out of the viewport.
        for (const shape of maskFrame.shapes) {
          if (shape.kind === "circle")
            area.circle(shape.cx, shape.cy, shape.radius).cut();
          else if (shape.points.length)
            area.poly(shape.points.flatMap((p) => [p.x, p.y]), true).cut();
        }
      } else {
        for (const shape of maskFrame.shapes) {
          if (shape.kind === "circle")
            area.circle(shape.cx, shape.cy, shape.radius).fill({
              color: "#fff",
            });
          else if (shape.points.length)
            area.poly(shape.points.flatMap((p) => [p.x, p.y]), true).fill({
              color: "#fff",
            });
        }
      }
    }
    root.addChild(mask);
    root.mask = mask;
    const g = this.graphics(root);
    g.rect(0, 0, frame.viewport.width, frame.viewport.height).fill({
      color: portal.fill,
    });
  }

  private drawPortalStrokes(frame: SceneFrame): void {
    const portal = frame.portal;
    if (!portal || !portal.visible || portal.opacity <= 0) return;
    const root = this.container("portal-strokes", this.stage);
    root.zIndex = (frame.layers.find(layer => layer.id === "labels")?.order ?? 50) - 0.5;
    const portalStroke = portal.stroke;
    if (portalStroke && portalStroke.opacity > 0) {
      const stroke = this.graphics(root);
      stroke.alpha = 1;
      this.drawCurve(
        stroke,
        portalStroke.path,
        portalStroke.color,
        portalStroke.width,
        portalStroke.opacity,
      );
    }
    const portalEcho = portal.echo;
    if (portalEcho && portalEcho.opacity > 0) {
      const echo = this.graphics(root);
      this.drawCurve(
        echo,
        portalEcho.path,
        portalEcho.color,
        portalEcho.width,
        portalEcho.opacity,
      );
    }
  }

  private drawLabels(frame: SceneFrame): void {
    const root = this.container("labels", this.stage);
    root.zIndex = frame.layers.find(layer => layer.id === "labels")?.order ?? 50;
    this.stage.addChild(root);
    const colors = palette(frame.visualTheme);
    for (const label of frame.labels) {
      if (label.opacity <= 0.001) continue;
      const group = this.container(`label:${label.id}`, root);
      root.addChild(group);
      group.position.set(label.layout.hinge.x, label.layout.hinge.y);
      group.scale.set(label.layout.scale);
      group.alpha = label.opacity;
      const dx = label.layout.offset.x, dy = label.layout.offset.y;
      const distance = Math.hypot(dx, dy);
      const axis = Math.atan2(dy, dx);
      const flip = label.page?.squash ?? 1;
      const c = Math.cos(axis), n = Math.sin(axis);
      const page = this.container(`page:${label.id}`, group);
      page.setFromMatrix(new this.pixi.Matrix(c*c*flip+n*n, c*n*(flip-1), c*n*(flip-1), n*n*flip+c*c, 0, 0));
      page.alpha = label.page?.opacity ?? 1;
      if (label.page && label.visual === "current") {
        const pin = this.graphics(group);
        group.setChildIndex(pin, 0);
        pin.circle(0, 0, 2.6).fill({ color: colors.amber }).stroke({ color: colors.paper, width: 1.1 });
      }
      if (distance > 0.0001) {
        const role = label.attachment?.role;
        const current = label.visual === "current";
        const global = role === "operation";
        const local = role === "local";
        const end = Math.max(4, distance - 14);
        const stem = this.graphics(page);
        stem.moveTo(0, 0).lineTo(dx / distance * end, dy / distance * end).stroke({
          color: current ? colors.amber : global || local || label.visual === "nav" ? colors.stemNav : colors.stem,
          width: current ? 1.45 : global ? 1.3 : local ? 1.05 : 1.15,
          alpha: current ? 0.96 : global ? 0.92 : local ? 0.78 : 0.82,
        });
      }
      const leaf = this.container(`leaf:${label.id}`, page);
      leaf.position.set(dx, dy);
      leaf.rotation = label.layout.degree * Math.PI / 180;
      leaf.scale.set(1);
      leaf.alpha = 1;
      const highlighted = Boolean(label.interaction?.hover || label.interaction?.focus || label.interaction?.press);
      const activeIcon = Boolean(label.symbolGeometry && (label.symbolActivity ?? 0) >= 0.35);
      const ink = highlighted || activeIcon || label.resonating || label.visual === "nav" ? colors.amber : label.visual === "background" ? colors.quiet : colors.accent;
      if (highlighted || label.resonating || label.visual === "current") {
        const ring = this.graphics(leaf);
        const points = Array.from({ length: 65 }, (_, i) => ({ x: 16 * Math.cos(i * Math.PI / 32), y: 16 * Math.sin(i * Math.PI / 32) }));
        this.polyline(ring, points, colors.amber, 1.25, highlighted ? 1 : label.resonating ? 0.92 : 0.65, [3, 3]);
      }
      if (!label.icon && !label.symbolGeometry) {
        const text = label.contentKind === "text";
        this.drawText(leaf, {
          type: "text", x: 0, y: 0, text: label.glyph,
          fontSize: label.visual === "background" ? 13 : label.visual === "nav" ? 16 : text ? 14.5 : 16.5,
          fontWeight: label.visual === "current" ? 720 : label.visual === "background" ? 520 : label.visual === "nav" ? 620 : 560,
          fontFamily: text ? this.fontFamily : this.fontSymbol,
          fill: ink, stroke: colors.paper, strokeWidth: 4, align: "center", baseline: "middle",
        }, frame);
      } else {
        const glyph = this.graphics(leaf);
        const symbol = label.symbolGeometry;
        const optical = symbol?.optical.opticalScale ?? label.icon?.opticalScale ?? 1;
        const offset = symbol?.optical.opticalOffset ?? label.icon?.opticalOffset ?? { x: 0, y: 0 };
        const scale = 20 / 24;
        const map = (point: Vec) => ({ x: (point.x - 12 + offset.x) * optical * scale, y: (point.y - 12 + offset.y) * optical * scale });
        const width = symbol ? (symbol.optical.baseStrokeWidth + symbol.optical.strokeCompensation) * optical * scale : 1.8 * optical * scale;
        if (symbol) {
          for (const path of symbol.paths) this.polyline(glyph, path.points.map(map), ink, width * (path.strokeScale ?? 1), path.opacity ?? 1);
        } else if (label.icon) {
          for (const points of this.icons.getIcon(label.icon)) this.polyline(glyph, points.map(map), ink, width, 1);
        }
        for (const point of symbol?.points ?? []) {
          const p = map(point);
          glyph.circle(p.x, p.y, point.r * optical * scale);
          if (point.filled) glyph.fill({ color: ink, alpha: point.opacity ?? 1 });
          else glyph.stroke({ color: ink, width, alpha: point.opacity ?? 1 });
        }
      }
    }
  }

  private drawPrimitive(
    parent: PixiContainer,
    primitive: Exclude<ScenePrimitive, TextPrimitive>,
    frame: SceneFrame,
  ): void {
    const g = this.graphics(parent, false);
    const signature = JSON.stringify(primitive);
    if (this.primitiveSignatures.get(g) === signature) return;
    this.primitiveSignatures.set(g, signature);
    g.clear();
    switch (primitive.type) {
      case "circle":
        this.drawCircle(g, primitive);
        break;
      case "arc":
        this.drawArc(g, primitive);
        break;
      case "polyline":
        this.drawPolylinePrimitive(g, primitive);
        break;
      case "rect":
        this.drawRect(g, primitive);
        break;
    }
    // Shape opacity is applied once by paint().
    void frame;
  }

  private drawCircle(g: PixiGraphics, p: CirclePrimitive): void {
    if (p.dash?.length && p.stroke) {
      if (p.fill) g.circle(p.cx, p.cy, p.radius).fill({ color: p.fill, alpha: p.opacity ?? 1 });
      const steps = Math.min(2048, Math.max(32, Math.ceil(2 * Math.PI * p.radius / 3)));
      const points = Array.from({ length: steps + 1 }, (_, i) => ({ x: p.cx + p.radius * Math.cos(i * 2 * Math.PI / steps), y: p.cy + p.radius * Math.sin(i * 2 * Math.PI / steps) }));
      this.polyline(g, points, p.stroke, p.strokeWidth ?? 1, p.opacity ?? 1, p.dash);
      return;
    }
    g.circle(p.cx, p.cy, p.radius);
    this.paint(g, p.fill, p.stroke, p.strokeWidth, p.opacity);
  }

  private drawArc(g: PixiGraphics, p: ArcPrimitive): void {
    const start = p.startAngle;
    const end = p.endAngle;
    g.moveTo(
      p.cx + Math.cos(start) * p.radius,
      p.cy + Math.sin(start) * p.radius,
    );
    g.arc(p.cx, p.cy, p.radius, start, end, p.anticlockwise ?? false);
    this.paint(g, p.fill, p.stroke, p.strokeWidth, p.opacity);
  }

  private drawPolylinePrimitive(
    g: PixiGraphics,
    p: PolylinePrimitive,
  ): void {
    if (!p.points.length) return;
    if (p.dash?.length && p.stroke && !p.fill) {
      this.polyline(g, p.closed ? [...p.points, p.points[0]] : p.points, p.stroke, p.strokeWidth ?? 1, p.opacity ?? 1, p.dash);
      return;
    }
    if (p.closed)
      g.poly(p.points.flatMap((point) => [point.x, point.y]), true);
    else {
      g.moveTo(p.points[0].x, p.points[0].y);
      for (let i = 1; i < p.points.length; i++)
        g.lineTo(p.points[i].x, p.points[i].y);
    }
    this.paint(g, p.fill, p.stroke, p.strokeWidth, p.opacity);
  }

  private drawRect(g: PixiGraphics, p: RectPrimitive): void {
    if (p.radius) g.roundRect(p.x, p.y, p.width, p.height, p.radius);
    else g.rect(p.x, p.y, p.width, p.height);
    this.paint(g, p.fill, p.stroke, p.strokeWidth, p.opacity);
  }

  private paint(
    g: PixiGraphics,
    fill: string | undefined,
    stroke: string | undefined,
    width: number | undefined,
    opacity: number | undefined,
  ): void {
    if (fill && fill !== "none")
      g.fill({ color: fill, alpha: opacity ?? 1 });
    if (stroke && stroke !== "none")
      g.stroke({
        color: stroke,
        width: Math.max(0.25, width ?? 1),
        alpha: opacity ?? 1,
      });
  }

  private polyline(
    g: PixiGraphics,
    points: readonly Vec[],
    color: string,
    width: number,
    opacity: number,
    dash?: readonly number[],
  ): void {
    if (points.length < 2) return;
    const pattern = dash?.filter(value => Number.isFinite(value) && value > 0) ?? [];
    if (pattern.length % 2) pattern.push(...pattern);
    g.moveTo(points[0].x, points[0].y);
    let phase = 0, remaining = pattern[0] ?? Infinity;
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1], to = points[i];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      let along = 0;
      while (along < length) {
        const step = Math.min(remaining, length - along);
        along += step;
        const x = from.x + (to.x - from.x) * along / length;
        const y = from.y + (to.y - from.y) * along / length;
        if (phase % 2 === 0) g.lineTo(x, y); else g.moveTo(x, y);
        remaining -= step;
        if (remaining <= 1e-8 && pattern.length) { phase = (phase + 1) % pattern.length; remaining = pattern[phase]; }
      }
    }
    g.stroke({
      color,
      width: Math.max(0.25, width),
      alpha: opacity,
      cap: "round",
    });
  }

  private drawCurve(
    g: PixiGraphics,
    curve: NonNullable<NonNullable<SceneFrame["portal"]>["stroke"]>["path"],
    color: string,
    width: number,
    opacity: number,
  ): void {
    if (curve.kind === "circle") {
      g.circle(curve.cx, curve.cy, curve.radius).stroke({
        color,
        width: Math.max(0.25, width),
        alpha: opacity,
      });
      return;
    }
    this.polyline(g, curve.points, color, width, opacity);
  }

  private drawText(
    parent: PixiContainer,
    primitive: TextPrimitive,
    frame: SceneFrame,
  ): void {
    let parentId = this.parentIds.get(parent);
    if (parentId === undefined) { parentId = ++this.nextParentId; this.parentIds.set(parent, parentId); }
    const slot = this.textCursors.get(parent) ?? 0;
    this.textCursors.set(parent, slot + 1);
    const key = [
      parentId, slot,
      primitive.text,
      primitive.fontSize, primitive.fontWeight, primitive.stroke, primitive.strokeWidth,
      primitive.fontFamily, primitive.align, primitive.baseline,
      primitive.fill ?? "",
      frame.visualTheme,
      this.dpr,
      this.fontFamily,
    ].join(":");
    const text = this.glyphs.getOrCreate(key, () => {
      const value = new this.pixi.Text({
        text: primitive.text,
        style: {
          fontFamily: primitive.fontFamily ?? this.fontFamily,
          fontSize: Math.max(1, primitive.fontSize),
          fontWeight: String(primitive.fontWeight ?? 400) as import("pixi.js").TextStyleFontWeight,
          stroke: primitive.stroke ? { color: primitive.stroke, width: primitive.strokeWidth ?? 1, join: "round" } : undefined,
          fill: colorFrom(
            primitive.fill,
            palette(frame.visualTheme).ink,
          ),
          align: primitive.align ?? "center",
        },
      });
      value.anchor.set(
        primitive.align === "left" ? 0 : primitive.align === "right" ? 1 : 0.5,
        primitive.baseline === "top"
          ? 0
          : primitive.baseline === "bottom"
            ? 1
            : 0.5,
      );
      return value;
    });
    text.visible = true;
    text.position.set(primitive.x, primitive.y);
    text.scale.set(primitive.scale ?? 1);
    text.rotation = ((primitive.angle ?? 0) * Math.PI) / 180;
    text.alpha = primitive.opacity ?? 1;
    parent.addChild(text);
  }
}
