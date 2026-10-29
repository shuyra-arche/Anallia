import type {
  ArcPrimitive,
  BackgroundFrame,
  CirclePrimitive,
  GraphicsRenderer,
  LabelFrame,
  MaskCurve,
  PolylinePrimitive,
  PortalFrame,
  RectPrimitive,
  SceneFrame,
  SceneMask,
  ScenePrimitive,
  TextPrimitive,
} from "../../core/graphics.ts";
import type { IconToken } from "../../core/icons.ts";
import type {
  PointGeometry,
  SymbolGeometry,
  SymbolKind,
} from "../../core/symbol-morph.ts";
import type { Vec } from "../../core/types.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Tie order for equal layer orders. */
const LAYER_TIES: readonly string[] = [
  "base",
  "portal",
  "background",
  "hubs",
  "relations",
  "labels",
  "reading",
  "loading",
];

const STEM_COLORS: Readonly<Record<string, string>> = {
  light: "#8fa99e",
  parchment: "#b08d74",
  celadon: "#7ea1b0",
  rosewood: "#a68497",
  ivory: "#8796b8",
  dark: "#5a7974",
  obsidian: "#6c7377",
  abyss: "#55709e",
};

type ShapePrimitive = Exclude<ScenePrimitive, TextPrimitive>;

export interface SvgGraphicsRendererOptions {
  /** Prefix for every owned element id; defaults to a per-instance unique prefix. */
  idPrefix?: string;
}

let rendererSequence = 0;

// ── formatting ─────────────────────────────────────────────────────────────

function num(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "0";
}

/** Writes `name` only when the serialized value differs from the current attribute. */
function attr(node: Element, name: string, value: string | number | null | undefined): void {
  const next = value === null || value === undefined ? null : String(value);
  if (node.getAttribute(name) === next) return;
  if (next === null) node.removeAttribute(name);
  else node.setAttribute(name, next);
}

/** Writes an inline style property only when the current value differs. */
function style(node: SVGElement, name: string, value: string | null): void {
  if (node.style.getPropertyValue(name) === (value ?? "")) return;
  if (value === null) node.style.removeProperty(name);
  else node.style.setProperty(name, value);
}

/** M/L path built from numeric points only. */
function pointsPath(points: readonly Vec[], closed = false): string {
  let d = "";
  for (let i = 0; i < points.length; i++) d += `${i ? "L" : "M"}${num(points[i].x)} ${num(points[i].y)}`;
  return closed && d ? `${d}Z` : d;
}

function setPoints(node: Element, points: readonly Vec[], closed = false): void {
  attr(node, "d", points.length ? pointsPath(points, closed) : null);
}

function arcPath(primitive: ArcPrimitive): string {
  const { cx, cy, radius, startAngle, endAngle } = primitive;
  const point = (angle: number) => `${num(cx + Math.cos(angle) * radius)} ${num(cy + Math.sin(angle) * radius)}`;
  const delta = endAngle - startAngle;
  const anticlockwise = primitive.anticlockwise ?? delta < 0;
  const sweep = anticlockwise ? 0 : 1;
  const r = num(Math.max(0, radius));
  const from = point(startAngle);
  if (Math.abs(delta) >= Math.PI * 2 - 1e-8) {
    return `M${from}A${r} ${r} 0 0 ${sweep} ${point(startAngle + Math.PI)}A${r} ${r} 0 0 ${sweep} ${from}`;
  }
  const turn = Math.PI * 2;
  const span = ((anticlockwise ? -delta : delta) % turn + turn) % turn;
  return `M${from}A${r} ${r} 0 ${span > Math.PI ? 1 : 0} ${sweep} ${point(endAngle)}`;
}

function paintShape(node: Element, primitive: ShapePrimitive): void {
  const stroke = primitive.stroke && primitive.stroke !== "none" ? primitive.stroke : null;
  attr(node, "fill", primitive.fill && primitive.fill !== "none" ? primitive.fill : "none");
  attr(node, "stroke", stroke);
  attr(node, "stroke-width", stroke ? num(Math.max(0, primitive.strokeWidth ?? 1)) : null);
  attr(node, "opacity", primitive.opacity === undefined ? null : num(primitive.opacity));
  attr(node, "stroke-dasharray", stroke && primitive.dash?.length ? primitive.dash.map(num).join(" ") : null);
  attr(node, "stroke-linecap", stroke ? (primitive.lineCap ?? null) : null);
  attr(node, "stroke-linejoin", stroke ? (primitive.lineJoin ?? null) : null);
}

function paintText(node: Element, primitive: TextPrimitive): void {
  const transforms: string[] = [];
  if (primitive.angle) transforms.push(`rotate(${num(primitive.angle)} ${num(primitive.x)} ${num(primitive.y)})`);
  if (primitive.scale !== undefined && primitive.scale !== 1)
    transforms.push(
      `translate(${num(primitive.x)} ${num(primitive.y)}) scale(${num(primitive.scale)}) translate(${num(-primitive.x)} ${num(-primitive.y)})`,
    );
  attr(node, "x", num(primitive.x));
  attr(node, "y", num(primitive.y));
  attr(node, "text-anchor", primitive.align === "left" ? "start" : primitive.align === "right" ? "end" : null);
  attr(node, "dominant-baseline", primitive.baseline && primitive.baseline !== "alphabetic" ? primitive.baseline : null);
  attr(node, "font-size", num(Math.max(0, primitive.fontSize)));
  attr(node, "font-family", primitive.fontFamily ?? null);
  attr(node, "font-weight", primitive.fontWeight ?? null);
  attr(node, "transform", transforms.length ? transforms.join(" ") : null);
  const stroke = primitive.stroke && primitive.stroke !== "none" ? primitive.stroke : null;
  attr(node, "fill", primitive.fill && primitive.fill !== "none" ? primitive.fill : null);
  attr(node, "stroke", stroke);
  attr(node, "stroke-width", stroke ? num(Math.max(0, primitive.strokeWidth ?? 0)) : null);
  attr(node, "vector-effect", stroke && primitive.strokeScale === "screen" ? "non-scaling-stroke" : null);
  attr(node, "paint-order", stroke ? "stroke" : null);
  attr(node, "stroke-linejoin", stroke ? "round" : null);
  attr(node, "opacity", primitive.opacity === undefined ? null : num(primitive.opacity));
  if (node.textContent !== primitive.text) node.textContent = primitive.text;
}

// ── labels ─────────────────────────────────────────────────────────────────

interface LabelNode {
  group: SVGGElement;
  pin: SVGCircleElement;
  leaf: SVGGElement;
  stem: SVGPathElement;
  visual: SVGGElement;
  ring: SVGCircleElement;
  icon: SVGSVGElement;
  iconGlyph: SVGGElement;
  text: SVGTextElement;
  hit: SVGRectElement;
  paths: Map<string, SVGPathElement>;
  points: Map<string, SVGCircleElement>;
  iconId: string | null;
  kind: SymbolKind | null;
  shown: boolean;
}

interface BackgroundNode {
  flow: SVGGElement;
  stars: SVGGElement;
  paths: SVGPathElement[];
  markers: SVGCircleElement[];
  points: SVGCircleElement[];
  trails: SVGPathElement[];
  meteors: SVGPathElement[];
  heads: SVGCircleElement[];
}

interface ClipNode {
  root: SVGClipPathElement;
  path: SVGPathElement;
}

function stemTier(label: LabelFrame): string {
  const role = label.attachment?.role;
  if (role === "operation") return "global";
  if (role === "local") return "local";
  if (label.visual === "current") return "current";
  return "ordinary";
}

/** Typography class: the current label keeps its `current` class but text content uses the sans stack. */
function textClass(label: LabelFrame): string {
  const content = label.contentKind === "text" ? " is-text" : label.contentKind === "symbol" ? " is-symbol" : "";
  if (label.visual === "current") return `label current${content}`;
  if (label.visual === "background") return "label background is-text";
  if (label.visual === "nav") return "label nav";
  return `label${content}`;
}

/**
 * Standalone numeric SceneFrame → SVG renderer. The frame holds screen-space
 * numbers, so nothing here transforms world coordinates. Owns its graphics group,
 * clip defs and pooled background/label nodes under the caller's root.
 */
export class SvgGraphicsRenderer implements GraphicsRenderer {
  readonly kind = "svg" as const;
  readonly root: SVGSVGElement;
  readonly idPrefix: string;
  readonly graphics: SVGGElement;

  private readonly doc: Document;
  private readonly layerRoots = new Map<string, SVGGElement>();
  private readonly primitiveNodes = new WeakMap<Element, SVGElement[]>();
  private readonly labels = new Map<string, LabelNode>();
  private readonly clips = new Map<string, ClipNode>();
  private readonly defs: SVGDefsElement;
  private readonly flow: BackgroundNode;
  private readonly portalFill: SVGRectElement;
  private readonly portalStrokes: SVGGElement;
  private readonly portalStroke: SVGPathElement;
  private readonly portalEcho: SVGPathElement;
  private readonly previousViewBox: string | null;
  private readonly previousWidth: string | null;
  private readonly previousHeight: string | null;
  private lastFrame: SceneFrame | null = null;
  private lastRevision = -1;
  private lastBackground: BackgroundFrame | null = null;
  private width = 0;
  private height = 0;
  private destroyed = false;

  constructor(root: SVGSVGElement, options: SvgGraphicsRendererOptions = {}) {
    this.root = root;
    this.doc = root.ownerDocument;
    this.idPrefix = options.idPrefix ?? `svg-graphics-${++rendererSequence}`;
    this.previousViewBox = root.getAttribute("viewBox");
    this.previousWidth = root.getAttribute("width");
    this.previousHeight = root.getAttribute("height");
    this.graphics = this.element<SVGGElement>("g", {
      class: "svg-graphics",
      id: `${this.idPrefix}-graphics`,
      "aria-hidden": "true",
      "pointer-events": "none",
    });
    this.defs = this.element<SVGDefsElement>("defs", { id: `${this.idPrefix}-defs` });
    this.graphics.append(this.defs);
    this.layer("portal");
    this.portalFill = this.element<SVGRectElement>("rect", { class: "portal-bg portal-fill", "pointer-events": "none" });
    this.layer("portal").prepend(this.portalFill);
    // Swept strokes sit between the portal fill and the next layer, always before labels.
    this.portalStrokes = this.element<SVGGElement>("g", { class: "svg-portal-strokes", "pointer-events": "none" });
    this.portalStroke = this.element<SVGPathElement>("path", { class: "portal-stroke", fill: "none", "pointer-events": "none" });
    this.portalEcho = this.element<SVGPathElement>("path", { class: "portal-echo-stroke", fill: "none", "pointer-events": "none" });
    this.portalStrokes.append(this.portalStroke, this.portalEcho);
    this.graphics.append(this.portalStrokes);
    this.flow = {
      flow: this.element<SVGGElement>("g", { class: "background-flow" }),
      stars: this.element<SVGGElement>("g", { class: "background-stars" }),
      paths: [],
      markers: [],
      points: [],
      trails: [],
      meteors: [],
      heads: [],
    };
    this.layer("background").append(this.flow.flow, this.flow.stars);
    root.append(this.graphics);
  }

  /** Owned layer group for `id`; created once and reused across frames. */
  layer(id: string): SVGGElement {
    let group = this.layerRoots.get(id);
    if (!group) {
      group = this.element<SVGGElement>("g", {
        class: `svg-layer svg-layer-${id}`,
        "data-layer": id,
        "pointer-events": "none",
      });
      this.layerRoots.set(id, group);
      this.graphics.append(group);
    }
    return group;
  }

  resize(width: number, height: number, _dpr = 1): void {
    if (this.destroyed || (width === this.width && height === this.height)) return;
    this.width = width;
    this.height = height;
    attr(this.root, "viewBox", `0 0 ${num(width)} ${num(height)}`);
    attr(this.root, "width", num(width));
    attr(this.root, "height", num(height));
  }

  render(frame: SceneFrame): void {
    if (this.destroyed) return;
    const viewport = frame.viewport;
    if (viewport && viewport.width !== this.width) this.resize(viewport.width, this.height || viewport.height);
    if (viewport && viewport.height !== this.height) this.resize(this.width || viewport.width, viewport.height);
    const sameFrame = this.lastFrame === frame && this.lastRevision === frame.revision;
    this.lastRevision = frame.revision;
    const background = frame.background;
    const backgroundChanged = background !== this.lastBackground;
    this.lastBackground = background;
    this.lastFrame = frame;
    if (sameFrame && !backgroundChanged) return;
    if (!sameFrame) {
      this.renderClips(frame);
      this.renderLayers(frame);
      this.renderPortal(frame);
      this.renderLabels(frame);
    }
    if (!sameFrame || backgroundChanged) this.renderBackground(background);
  }

  /** Removes only nodes created by this renderer and restores the root attributes it changed. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.graphics.remove();
    this.layerRoots.clear();
    this.clips.clear();
    this.labels.clear();
    this.lastFrame = null;
    this.lastBackground = null;
    attr(this.root, "viewBox", this.previousViewBox);
    attr(this.root, "width", this.previousWidth);
    attr(this.root, "height", this.previousHeight);
  }

  // ── layers ───────────────────────────────────────────────────────────────

  /** Frame layers in paint order: numeric order, then the fixed tie order. */
  private sortLayers(frame: SceneFrame) {
    return frame.layers
      .map((layer, index) => ({ layer, index, tie: LAYER_TIES.indexOf(layer.id) }))
      .sort((a, b) => a.layer.order - b.layer.order || a.tie - b.tie || a.index - b.index);
  }

  private renderLayers(frame: SceneFrame): void {
    const ordered = new Map(this.sortLayers(frame).map((entry) => [entry.layer.id, entry.layer]));
    for (const entry of this.sortLayers(frame)) {
      const id = entry.layer.id;
      if (id === "labels" || id === "portal" || id === "background" || id === "reading") continue;
      this.paintPrimitives(this.layer(id), entry.layer.primitives);
    }
    const reading = ordered.get("reading");
    if (reading) this.paintPrimitives(this.layer("reading"), reading.primitives);

    // One ordered list of live layers; undeclared pooled layers are hidden.
    const sequence: SVGGElement[] = [];
    const declared = new Set<string>();
    for (const entry of this.sortLayers(frame)) {
      const id = entry.layer.id;
      if (declared.has(id)) continue;
      declared.add(id);
      sequence.push(this.layer(id));

    }
    if (declared.has("portal")) {
      const labelIndex = sequence.indexOf(this.layer("labels"));
      sequence.splice(labelIndex < 0 ? sequence.length : labelIndex, 0, this.portalStrokes);
    }
    attr(this.portalStrokes, "display", declared.has("portal") ? null : "none");
    for (const [id, group] of this.layerRoots) {
      if (declared.has(id)) continue;
      attr(group, "display", "none");
      if (id !== "portal" && id !== "background" && id !== "labels") continue;
      sequence.push(group);
    }
    for (const id of declared) {
      const group = this.layerRoots.get(id);
      if (group) attr(group, "display", null);
    }
    this.orderChildren(this.graphics, [this.defs, ...sequence]);
  }

  /** Moves children only when the live order differs from the current one. */
  private orderChildren(parent: Element, order: Element[]): void {
    let cursor: Element | null = parent.firstElementChild;
    for (const node of order) {
      const current = cursor;
      if (current === node) cursor = node.nextElementSibling;
      else parent.insertBefore(node, current);
    }
  }

  private paintPrimitives(parent: SVGGElement, primitives: ScenePrimitive[]): void {
    let nodes = this.primitiveNodes.get(parent);
    if (!nodes) {
      nodes = [];
      this.primitiveNodes.set(parent, nodes);
    }
    for (let i = 0; i < primitives.length; i++) {
      const primitive = primitives[i];
      let node = nodes[i];
      if (node?.getAttribute("data-svg-primitive") !== primitive.type) {
        node?.remove();
        node = this.primitiveElement(primitive);
        nodes[i] = node;
        parent.insertBefore(node, parent.childNodes[i] ?? null);
      }
      if (primitive.type === "text") paintText(node, primitive);
      else this.paintShapePrimitive(node, primitive);
    }
    for (let i = primitives.length; i < nodes.length; i++) nodes[i].remove();
    nodes.length = primitives.length;
    this.orderChildren(parent, nodes);
  }

  private primitiveElement(primitive: ScenePrimitive): SVGElement {
    const tag =
      primitive.type === "text" ? "text" : primitive.type === "circle" ? "circle" : primitive.type === "rect" ? "rect" : "path";
    return this.element<SVGElement>(tag, {
      class: primitive.type === "text" ? "svg-text" : `svg-${primitive.type}`,
      "data-svg-primitive": primitive.type,
      fill: "none",
    });
  }

  private paintShapePrimitive(node: SVGElement, primitive: ShapePrimitive): void {
    paintShape(node, primitive);
    switch (primitive.type) {
      case "circle": {
        const p = primitive as CirclePrimitive;
        attr(node, "cx", num(p.cx));
        attr(node, "cy", num(p.cy));
        attr(node, "r", num(Math.max(0, p.radius)));
        break;
      }
      case "arc":
        attr(node, "d", arcPath(primitive as ArcPrimitive));
        break;
      case "polyline":
        setPoints(node, (primitive as PolylinePrimitive).points, primitive.closed ?? false);
        break;
      case "rect": {
        const p = primitive as RectPrimitive;
        attr(node, "x", num(p.x));
        attr(node, "y", num(p.y));
        attr(node, "width", num(Math.max(0, p.width)));
        attr(node, "height", num(Math.max(0, p.height)));
        attr(node, "rx", p.radius ? num(p.radius) : null);
        break;
      }
    }
  }

  // ── clip paths ───────────────────────────────────────────────────────────

  private clipId(id: string): string {
    return `${this.idPrefix}-clip-${id}`;
  }

  private renderClips(frame: SceneFrame): void {
    const seen = new Set<string>();
    for (const mask of frame.masks) {
      this.paintClip(this.clipNode(mask), mask);
      seen.add(mask.id);
    }
    for (const [id, node] of this.clips) {
      if (seen.has(id)) continue;
      node.root.remove();
      this.clips.delete(id);
    }
    const portalId = frame.portal?.visible ? frame.portal.maskId : null;
    attr(this.portalFill, "clip-path", portalId && seen.has(portalId) ? `url(#${this.clipId(portalId)})` : null);
  }

  private clipNode(mask: SceneMask): ClipNode {
    let node = this.clips.get(mask.id);
    if (!node) {
      const root = this.element<SVGClipPathElement>("clipPath", {
        id: this.clipId(mask.id),
        clipPathUnits: "userSpaceOnUse",
      });
      const path = this.element<SVGPathElement>("path", { class: "clip-shape", "data-mask": mask.id });
      root.append(path);
      node = { root, path };
      this.clips.set(mask.id, node);
      this.defs.append(root);
    }
    return node;
  }

  /**
   * One numeric path: the outer rect face followed by every curve subpath. With
   * evenodd the curves cut holes, with nonzero closed curves enclose numbered faces.
   */
  private paintClip(node: ClipNode, mask: SceneMask): void {
    const rule = mask.rule;
    let d = "";
    if (mask.outerRect) {
      const rect = mask.outerRect;
      d += `M${num(rect.x)} ${num(rect.y)}H${num(rect.x + rect.width)}V${num(rect.y + rect.height)}H${num(rect.x)}Z`;
    }
    for (const curve of mask.shapes) d += curvePath(curve, mask.outerRect !== undefined);
    attr(node.path, "d", d || null);
    attr(node.path, "fill-rule", rule);
    attr(node.path, "clip-rule", rule);
    attr(node.path, "fill", mask.fill && mask.fill !== "none" ? mask.fill : "#fff");
    attr(node.path, "stroke", "none");
    attr(node.path, "display", mask.visible && mask.opacity > 0 ? null : "none");
    attr(node.root, "opacity", num(mask.opacity));
  }

  // ── background ───────────────────────────────────────────────────────────

  private renderBackground(background: BackgroundFrame | null): void {
    const node = this.flow;
    const root = node.flow.parentElement;
    if (root) attr(root, "opacity", background ? num(background.opacity) : null);
    const flowOn = background?.mode === "flow";
    const starsOn = background?.mode === "stars";
    attr(node.flow, "display", flowOn ? null : "none");
    attr(node.stars, "display", starsOn ? null : "none");
    if (!background) {
      for (const group of [node.flow, node.stars])
        for (const child of Array.from(group.children)) attr(child, "display", "none");
      return;
    }
    const stem = STEM_COLORS[background.theme] ?? STEM_COLORS.light;
    if (flowOn) {
      const lines = background.streamlines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const path = (node.paths[i] ??= this.append<SVGPathElement>(node.flow, "path", { class: "flow-line", fill: "none" }));
        const marker = (node.markers[i] ??= this.append<SVGCircleElement>(node.flow, "circle", { class: "flow-marker" }));
        attr(path, "display", null);
        attr(path, "d", line.points.length ? pointsPath(line.points) : null);
        attr(path, "stroke", stem);
        attr(path, "stroke-width", num(line.width));
        attr(path, "opacity", num(line.opacity));
        attr(marker, "display", null);
        attr(marker, "cx", num(line.marker.x));
        attr(marker, "cy", num(line.marker.y));
        attr(marker, "r", num(line.markerRadius));
        attr(marker, "fill", stem);
        attr(marker, "opacity", num(line.markerOpacity));
      }
      for (let i = lines.length; i < node.paths.length; i++) attr(node.paths[i], "display", "none");
      for (let i = lines.length; i < node.markers.length; i++) attr(node.markers[i], "display", "none");
    }
    if (!starsOn) return;
    const stars = background.stars;
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const point = (node.points[i] ??= this.append<SVGCircleElement>(node.stars, "circle", { class: "star-point" }));
      attr(point, "display", null);
      attr(point, "cx", num(star.at.x));
      attr(point, "cy", num(star.at.y));
      attr(point, "r", num(star.radius));
      attr(point, "fill", star.fill);
      attr(point, "opacity", num(star.opacity));
    }
    for (let i = stars.length; i < node.points.length; i++) attr(node.points[i], "display", "none");
    const trails = background.trails;
    for (let i = 0; i < trails.length; i++) {
      const trail = trails[i];
      const path = (node.trails[i] ??= this.append<SVGPathElement>(node.stars, "path", {
        class: "star-trail",
        fill: "none",
        "stroke-linecap": "round",
      }));
      const from = {
        x: trail.center.x + Math.cos(trail.startAngle) * trail.radius,
        y: trail.center.y + Math.sin(trail.startAngle) * trail.radius,
      };
      const to = {
        x: trail.center.x + Math.cos(trail.endAngle) * trail.radius,
        y: trail.center.y + Math.sin(trail.endAngle) * trail.radius,
      };
      const r = num(trail.radius);
      const large = Math.abs(trail.endAngle - trail.startAngle) > Math.PI ? 1 : 0;
      attr(path, "display", null);
      attr(path, "d", `M${num(from.x)} ${num(from.y)}A${r} ${r} 0 ${large} 1 ${num(to.x)} ${num(to.y)}`);
      attr(path, "stroke", trail.color);
      attr(path, "stroke-width", num(trail.width));
      attr(path, "opacity", num(trail.opacity));
    }
    for (let i = trails.length; i < node.trails.length; i++) attr(node.trails[i], "display", "none");
    const meteors = background.meteors;
    for (let i = 0; i < meteors.length; i++) {
      const meteor = meteors[i];
      const path = (node.meteors[i] ??= this.append<SVGPathElement>(node.stars, "path", {
        class: "star-meteor",
        fill: "none",
        "stroke-linecap": "round",
      }));
      const head = (node.heads[i] ??= this.append<SVGCircleElement>(node.stars, "circle", { class: "meteor-head" }));
      attr(path, "display", null);
      attr(path, "d", `M${num(meteor.from.x)} ${num(meteor.from.y)}L${num(meteor.to.x)} ${num(meteor.to.y)}`);
      attr(path, "stroke", meteor.color);
      attr(path, "stroke-width", num(meteor.width));
      attr(path, "opacity", num(meteor.opacity));
      attr(head, "display", null);
      attr(head, "cx", num(meteor.head.x));
      attr(head, "cy", num(meteor.head.y));
      attr(head, "r", num(meteor.headRadius));
      attr(head, "fill", meteor.color);
      attr(head, "opacity", num(meteor.opacity));
    }
    for (let i = meteors.length; i < node.meteors.length; i++) attr(node.meteors[i], "display", "none");
    for (let i = meteors.length; i < node.heads.length; i++) attr(node.heads[i], "display", "none");
  }

  // ── portal ───────────────────────────────────────────────────────────────

  private renderPortal(frame: SceneFrame): void {
    const portal = frame.portal;
    const visible = Boolean(portal && portal.visible && portal.opacity > 0);
    attr(this.portalFill, "display", visible ? null : "none");
    if (!portal) {
      this.paintCurve(this.portalStroke, null);
      this.paintCurve(this.portalEcho, null);
      return;
    }
    attr(this.portalFill, "opacity", num(portal.opacity));
    attr(this.portalFill, "x", 0);
    attr(this.portalFill, "y", 0);
    attr(this.portalFill, "width", num(frame.viewport.width));
    attr(this.portalFill, "height", num(frame.viewport.height));
    attr(this.portalFill, "fill", portal.fill);
    this.paintCurve(this.portalStroke, portal.stroke);
    this.paintCurve(this.portalEcho, portal.echo);
  }

  private paintCurve(node: SVGPathElement, curve: PortalFrame["stroke"] | PortalFrame["echo"] | null): void {
    attr(node, "d", curve ? curvePath(curve.path, true) : null);
    attr(node, "stroke", curve?.color ?? null);
    attr(node, "stroke-width", curve ? num(Math.max(0.25, curve.width)) : null);
    attr(node, "opacity", curve ? num(curve.opacity) : null);
    attr(node, "stroke-dasharray", curve?.dash?.length ? curve.dash.map(num).join(" ") : null);
  }

  // ── labels ───────────────────────────────────────────────────────────────

  private renderLabels(frame: SceneFrame): void {
    const root = this.layer("labels");
    const seen = new Set<string>();
    for (const label of frame.labels) {
      seen.add(label.id);
      this.paintLabel(this.labelNode(label), label);
    }
    for (const [id, node] of this.labels) {
      if (seen.has(id) || !node.shown) continue;
      node.shown = false;
      attr(node.group, "display", "none");
    }
    this.orderChildren(
      root,
      frame.labels.map((label) => this.labels.get(label.id)!.group),
    );
  }

  private labelNode(label: LabelFrame): LabelNode {
    let node = this.labels.get(label.id);
    if (!node) {
      const group = this.element<SVGGElement>("g", { class: "tag-group", "data-label": label.id, "aria-hidden": "true" });
      const pin = this.element<SVGCircleElement>("circle", { class: "page-pin", cx: 0, cy: 0, r: 2.6 });
      const leaf = this.element<SVGGElement>("g", { class: "page-leaf" });
      const stem = this.element<SVGPathElement>("path", { class: "stem" });
      const visual = this.element<SVGGElement>("g", { class: "label-visual" });
      const ring = this.element<SVGCircleElement>("circle", { class: "label-ring", cx: 0, cy: 0, r: 16 });
      const icon = this.element<SVGSVGElement>("svg", {
        class: "label-icon",
        viewBox: "0 0 24 24",
        width: 20,
        height: 20,
        x: -10,
        y: -10,
        overflow: "visible",
        display: "none",
        "aria-hidden": "true",
      });
      const iconGlyph = this.element<SVGGElement>("g", { class: "label-icon-glyph" });
      icon.append(iconGlyph);
      const text = this.element<SVGTextElement>("text", { class: "label" });
      const hit = this.element<SVGRectElement>("rect", { class: "label-hit", height: 44, rx: 8 });
      style(hit, "pointer-events", "none");
      visual.append(ring, icon, text);
      leaf.append(stem, visual);
      group.append(pin, leaf, hit);
      this.layer("labels").append(group);
      node = {
        group,
        pin,
        leaf,
        stem,
        visual,
        ring,
        icon,
        iconGlyph,
        text,
        hit,
        paths: new Map(),
        points: new Map(),
        iconId: null,
        kind: null,
        shown: false,
      };
      this.labels.set(label.id, node);
    }
    return node;
  }

  private paintLabel(node: LabelNode, label: LabelFrame): void {
    const { layout } = label;
    const zoom = layout.scale > 0 ? layout.scale : 1;
    const dx = layout.offset.x;
    const dy = layout.offset.y;
    const offset = Math.hypot(dx, dy);
    const axis = Math.atan2(dy, dx);
    const axisDegrees = (axis * 180) / Math.PI;
    const distance = Math.max(offset, Math.hypot(layout.position.x - layout.hinge.x, layout.position.y - layout.hinge.y) / zoom);
    const content = label.contentKind ?? (label.icon || label.symbolKind ? "icon" : "text");
    const highlighted = Boolean(label.interaction?.hover || label.interaction?.focus || label.interaction?.press);

    // Frame feedback only: the proxy is aria-hidden, so CSS hover/focus never fires on it.
    const tone =
      highlighted || label.resonating
        ? "var(--amber)"
        : label.visual === "background"
          ? "var(--quiet)"
          : label.visual === "nav"
            ? "var(--amber)"
            : null;
    const ringOpacity = highlighted
      ? "1"
      : label.resonating
        ? "0.92"
        : label.visual === "current"
          ? "0.65"
          : "0";
    attr(node.group, "display", null);
    node.shown = true;
    attr(node.group, "transform", `translate(${num(layout.hinge.x)} ${num(layout.hinge.y)}) scale(${num(zoom)})`);
    attr(node.group, "opacity", label.opacity >= 0.999 ? null : num(label.opacity));
    attr(node.group, "data-content-kind", content);
    attr(node.group, "data-scope", label.attachment?.scope ?? null);
    attr(node.group, "data-role", label.attachment?.role ?? null);
    attr(node.group, "data-anchor", label.attachment?.anchor.id ?? null);
    attr(node.group, "data-host-hub", label.attachment?.anchor.hostHub ?? null);
    attr(node.group, "data-side", label.attachment?.side ?? null);
    attr(node.group, "data-local-scroll", label.localScrollHub ?? null);
    attr(node.group, "data-symbol-kind", label.symbolKind ?? null);
    attr(node.group, "data-icon", label.icon?.iconName ?? null);
    if (label.linkTarget) attr(node.group, "data-link-target", label.linkTarget);
    else attr(node.group, "data-link-target", null);
    const classes = ["tag-group"];
    if (label.visual === "current") classes.push("is-current");
    if (label.page) classes.push("turning");
    if (label.resonating) classes.push("is-resonating-ref");
    if (label.icon || label.symbolKind) classes.push("has-icon");
    attr(node.group, "class", classes.join(" "));

    // Pin sits at the hinge; stem leaves from (0, 0) toward the label.
    attr(node.pin, "fill", label.page && label.visual === "current" ? "var(--amber)" : null);
    attr(node.pin, "opacity", label.page && label.visual === "current" ? null : "0");
    const tier = stemTier(label);
    attr(node.stem, "class", `stem stem-${tier}${label.visual === "nav" ? " nav" : ""}`);
    const end = Math.max(4, distance - 14);
    const ux = offset > 1e-4 ? dx / offset : Math.cos(axis);
    const uy = offset > 1e-4 ? dy / offset : Math.sin(axis);
    attr(node.stem, "d", `M0 0L${num(ux * end)} ${num(uy * end)}`);

    // Leaf only squashes along the stem axis for a page turn; the visual group carries the offset.
    attr(node.leaf, "transform", label.page && label.page.squash !== 1 ? `rotate(${num(axisDegrees)}) scale(${num(label.page.squash)} 1) rotate(${num(-axisDegrees)})` : null);
    attr(node.leaf, "opacity", label.page && label.page.opacity < 0.999 ? num(label.page.opacity) : null);
    const visualTurns: string[] = [];
    if (dx || dy) visualTurns.push(`translate(${num(dx)} ${num(dy)})`);
    if (layout.degree) visualTurns.push(`rotate(${num(layout.degree)})`);
    attr(node.visual, "transform", visualTurns.length ? visualTurns.join(" ") : null);

    attr(node.ring, "opacity", ringOpacity);
    style(node.ring, "opacity", ringOpacity);

    const symbol = label.symbolGeometry;
    const usesSymbol = Boolean(symbol && label.symbolKind);
    const usesIcon = Boolean(label.icon) && !usesSymbol;
    attr(node.icon, "display", usesSymbol || usesIcon ? null : "none");
    attr(node.icon, "class", `label-icon ${label.visual}`);
    if (usesSymbol && symbol) this.renderSymbol(node, symbol, label.symbolKind!);
    else if (usesIcon && label.icon) {
      if (node.iconId !== label.icon.id) {
        this.populateIcon(node.iconGlyph, label.icon);
        node.iconId = label.icon.id;
      }
      this.clearSymbol(node);
    } else this.clearSymbol(node);

    attr(node.text, "class", usesSymbol || usesIcon ? `${textClass(label)} is-sr-only` : textClass(label));
    attr(node.text, "x", usesSymbol || usesIcon ? 0 : null);
    attr(node.text, "y", usesSymbol || usesIcon ? 0 : null);
    if (node.text.textContent !== label.glyph) node.text.textContent = label.glyph;
    style(node.text, "fill", tone);
    style(node.icon, "color", tone);

    attr(node.hit, "x", num(-layout.width / 2));
    attr(node.hit, "y", num(-layout.height / 2));
    attr(node.hit, "width", num(Math.max(0, layout.width)));
    attr(node.hit, "height", num(Math.max(0, layout.height)));
  }

  private populateIcon(target: SVGGElement, token: IconToken): void {
    target.replaceChildren();
    const stroke = (token.baseStrokeWidth + token.strokeCompensation).toFixed(2);
    const dx = (-12 + token.opticalOffset.x).toFixed(2);
    const dy = (-12 + token.opticalOffset.y).toFixed(2);
    target.setAttribute("transform", `translate(12 12) scale(${token.opticalScale}) translate(${dx} ${dy})`);
    target.setAttribute("stroke-width", stroke);
    for (const shape of token.shapes) {
      const node = this.element(shape.tag);
      for (const [name, value] of Object.entries(shape.attrs)) node.setAttribute(name, String(value));
      target.append(node);
    }
  }

  private renderSymbol(node: LabelNode, geometry: SymbolGeometry, kind: SymbolKind): void {
    const glyph = node.iconGlyph;
    const optical = geometry.optical;
    const stroke = optical.baseStrokeWidth + optical.strokeCompensation;
    const dx = (-12 + optical.opticalOffset.x).toFixed(2);
    const dy = (-12 + optical.opticalOffset.y).toFixed(2);
    attr(glyph, "transform", `translate(12 12) scale(${optical.opticalScale}) translate(${dx} ${dy})`);
    attr(glyph, "stroke-width", stroke.toFixed(2));
    attr(glyph, "data-symbol-kind", geometry.kind);
    attr(glyph, "data-symbol-morph", geometry.morph.toFixed(4));
    attr(glyph, "data-symbol-activity", geometry.activity.toFixed(3));
    if (node.kind !== kind || glyph.childElementCount !== geometry.paths.length + geometry.points.length) {
      glyph.replaceChildren();
      node.paths.clear();
      node.points.clear();
      node.kind = kind;
    }
    node.iconId = null;
    const order: Element[] = [];
    for (const part of geometry.paths) {
      let path = node.paths.get(part.id);
      if (!path) {
        path = this.element<SVGPathElement>("path", { class: `symbol-path is-${part.role}`, "data-part-id": part.id, fill: "none" });
        node.paths.set(part.id, path);
      }
      setPoints(path, part.points);
      attr(path, "stroke-width", part.strokeScale === undefined ? null : (stroke * part.strokeScale).toFixed(2));
      attr(path, "opacity", part.opacity === undefined ? null : part.opacity.toFixed(3));
      order.push(path);
    }
    for (const part of geometry.points) {
      let point = node.points.get(part.id);
      if (!point) {
        point = this.element<SVGCircleElement>("circle", { class: `symbol-point is-${part.role}`, "data-part-id": part.id });
        node.points.set(part.id, point);
      }
      this.paintSymbolPoint(point, part);
      order.push(point);
    }
    this.orderChildren(glyph, order);
  }

  private paintSymbolPoint(node: SVGCircleElement, part: PointGeometry): void {
    attr(node, "cx", part.x.toFixed(3));
    attr(node, "cy", part.y.toFixed(3));
    attr(node, "r", part.r.toFixed(3));
    const filled = part.filled !== false;
    attr(node, "fill", filled ? "currentColor" : "none");
    attr(node, "stroke", filled ? "none" : "currentColor");
    attr(node, "opacity", part.opacity === undefined ? null : part.opacity.toFixed(3));
  }

  private clearSymbol(node: LabelNode): void {
    if (node.kind === null && !node.iconGlyph.childElementCount) return;
    for (const path of node.paths.values()) path.remove();
    for (const point of node.points.values()) point.remove();
    node.paths.clear();
    node.points.clear();
    node.kind = null;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private element<T extends Element = SVGElement>(tag: string, attributes: Record<string, string | number | null> = {}): T {
    const node = this.doc.createElementNS(SVG_NS, tag) as unknown as T;
    for (const [name, value] of Object.entries(attributes))
      if (value !== null) node.setAttribute(name, String(value));
    return node;
  }

  private append<T extends SVGElement>(parent: Element, tag: string, attributes: Record<string, string | number | null> = {}): T {
    const node = this.element<T>(tag, attributes);
    parent.append(node);
    return node;
  }
}

function curvePath(curve: MaskCurve, closePolylines: boolean): string {
  if (curve.kind === "circle") {
    const { cx, cy } = curve;
    const r = Math.max(0, curve.radius);
    return `M${num(cx - r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 1 ${num(cx + r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 1 ${num(cx - r)} ${num(cy)}Z`;
  }
  if (!curve.points.length) return "";
  return pointsPath(curve.points, curve.closed ?? closePolylines);
}
