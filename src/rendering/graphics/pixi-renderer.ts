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
  private readonly glyphs = new GpuGlyphCache<PixiText>();
  private readonly icons = new IconGeometryCache();
  private fontFamily: string;
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
    this.dpr = dpr;
    this.renderer.resize(
      Math.max(1, Math.round(width)),
      Math.max(1, Math.round(height)),
      dpr,
    );
  }

  render(frame: SceneFrame): void {
    if (this.destroyed || this.lost) return;
    this.glyphs.setEnvironment({
      theme: frame.visualTheme,
      dpr: this.dpr,
      fontFamily: this.fontFamily,
    });
    this.stage.removeChildren();
    this.layerRoots.clear();
    const ordered = [...frame.layers].sort((a, b) => a.order - b.order);
    const addLayer = (id: string, primitives: SceneFrame["layers"][number]["primitives"]) => {
      const root = new this.pixi.Container();
      root.label = id;
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
    this.renderer.render(this.stage);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.glyphs.clear("manual");
    try {
      this.renderer.destroy();
    } catch {
      /* A failed context teardown must not block SVG fallback. */
    }
    this.canvas.remove();
  }

  private graphics(parent: PixiContainer): PixiGraphics {
    const g = new this.pixi.Graphics();
    parent.addChild(g);
    return g;
  }

  private drawBackground(frame: SceneFrame): void {
    const background = frame.background;
    if (!background || background.mode === "none" || background.opacity <= 0)
      return;
    const root = new this.pixi.Container();
    root.label = "background";
    root.alpha = background.opacity;
    this.stage.addChild(root);
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
    const root = new this.pixi.Container();
    root.label = "portal";
    root.alpha = portal.opacity;
    this.stage.addChild(root);
    const mask = new this.pixi.Graphics();
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
    const portalStroke = portal.stroke;
    if (portalStroke && portalStroke.opacity > 0) {
      const stroke = this.graphics(this.stage);
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
      const echo = this.graphics(this.stage);
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
    const root = new this.pixi.Container();
    root.label = "labels";
    this.stage.addChild(root);
    for (const label of frame.labels) {
      if (label.opacity <= 0.001) continue;
      const group = new this.pixi.Container();
      group.alpha = label.opacity;
      group.position.set(label.layout.hinge.x, label.layout.hinge.y);
      root.addChild(group);
      const zoom = label.layout.scale;
      const dx = label.layout.position.x - label.layout.hinge.x;
      const dy = label.layout.position.y - label.layout.hinge.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 1) {
        const stem = this.graphics(group);
        stem
          .moveTo(0, 0)
          .lineTo(dx, dy)
          .stroke({
            color: colorFrom(palette(frame.visualTheme).stem, "#8fa99e"),
            width: Math.max(0.5, 1.05 * zoom),
            alpha: 0.5,
            cap: "round",
          });
      }
      const leaf = new this.pixi.Container();
      leaf.position.set(dx, dy);
      leaf.rotation = (label.layout.degree * Math.PI) / 180;
      leaf.scale.set(zoom * (label.page?.squash ?? 1), zoom);
      leaf.alpha = label.page?.opacity ?? 1;
      group.addChild(leaf);
      const highlighted =
        label.interaction?.press ||
        label.interaction?.hover ||
        label.interaction?.focus ||
        (label.symbolActivity ?? 0) >= 0.35;
      const ink = colorFrom(
        highlighted
          ? palette(frame.visualTheme).amber
          : palette(frame.visualTheme).ink,
        "#233532",
      );
      const ring = this.graphics(leaf);
      if (!label.icon && !label.symbolGeometry) {
        ring
          .circle(0, 0, label.layout.width / 2)
          .fill({
            color: colorFrom(palette(frame.visualTheme).paper, "#f5f6f2"),
            alpha: 0.82,
          })
          .stroke({
            color: colorFrom(
              highlighted
                ? palette(frame.visualTheme).amber
                : palette(frame.visualTheme).line,
              "#256b63",
            ),
            width: highlighted ? 1.6 : 0.9,
            alpha: highlighted ? 0.9 : 0.5,
          });
        this.drawText(
          leaf,
          {
            type: "text",
            x: 0,
            y: 0,
            text: label.glyph,
            fontSize: 14,
            fontFamily: this.fontFamily,
            fill: ink,
            align: "center",
            baseline: "middle",
            opacity: 1,
          },
          frame,
        );
      } else {
        const glyph = this.graphics(leaf);
        const icon = label.icon
          ? this.icons.getIcon(label.icon)
          : label.symbolGeometry
            ? this.icons.getSymbol(label.symbolGeometry)
            : [];
        const scale = 20 / 24;
        const optical =
          label.symbolGeometry?.optical.opticalScale ??
          label.icon?.opticalScale ??
          1;
        const offsetX = label.symbolGeometry?.optical.opticalOffset.x ??
          label.icon?.opticalOffset.x ??
          0;
        const offsetY = label.symbolGeometry?.optical.opticalOffset.y ??
          label.icon?.opticalOffset.y ??
          0;
        for (const points of icon) {
          const mapped = points.map((p) => ({
            x: (p.x - 12 + offsetX) * optical * scale,
            y: (p.y - 12 + offsetY) * optical * scale,
          }));
          this.polyline(
            glyph,
            mapped,
            ink,
            highlighted ? 2.1 : 1.55,
            highlighted ? 1 : 0.9,
          );
        }
        for (const point of label.symbolGeometry?.points ?? []) {
          glyph
            .circle(
              (point.x - 12 + offsetX) * optical * scale,
              (point.y - 12 + offsetY) * optical * scale,
              Math.max(0.5, point.r * optical * scale),
            )
            .fill({
              color: ink,
              alpha: point.opacity ?? 1,
            });
        }
      }
      const hit = this.graphics(leaf);
      hit
        .rect(
          -label.layout.width / 2,
          -label.layout.height / 2,
          label.layout.width,
          label.layout.height,
        )
        .fill({ color: "#000", alpha: 0 });
    }
  }

  private drawPrimitive(
    parent: PixiContainer,
    primitive: Exclude<ScenePrimitive, TextPrimitive>,
    frame: SceneFrame,
  ): void {
    const g = this.graphics(parent);
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
    if (primitive.opacity !== undefined) g.alpha = primitive.opacity;
    void frame;
  }

  private drawCircle(g: PixiGraphics, p: CirclePrimitive): void {
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
  ): void {
    if (points.length < 2) return;
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
      g.lineTo(points[i].x, points[i].y);
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
    const key = [
      primitive.text,
      primitive.fontSize,
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
    text.position.set(primitive.x, primitive.y);
    text.rotation = ((primitive.angle ?? 0) * Math.PI) / 180;
    text.alpha = primitive.opacity ?? 1;
    parent.addChild(text);
  }
}
