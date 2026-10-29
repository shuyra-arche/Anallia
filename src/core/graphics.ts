import type {
  Camera,
  Command,
  Theme,
  Vec,
  Viewport,
} from "./types.ts";
import type { FieldAttachment } from "./attachments.ts";
import type { LabelContentKind } from "./icons.ts";
import type { PagePose } from "./transitions.ts";
import type { SymbolGeometry, SymbolKind } from "./symbol-morph.ts";

/** Requested renderer. `auto` tries WebGL once; software contexts and failures permanently settle on SVG. */
export type GraphicsRendererKind = "auto" | "webgl" | "svg";
/** Concrete renderer chosen for the current Scene instance. */
export type ResolvedRendererKind = "webgl" | "svg";

export interface GraphicsOptions {
  renderer?: GraphicsRendererKind;
  /** Device pixel ratio override; defaults to the host document's devicePixelRatio. */
  dpr?: number;
  /** Set false to omit the background layer from the numeric frame. */
  background?: boolean;
}

export interface ShapeStyle {
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  opacity?: number;
  dash?: readonly number[];
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
}

export interface CirclePrimitive extends ShapeStyle {
  type: "circle";
  cx: number;
  cy: number;
  radius: number;
}

export interface ArcPrimitive extends ShapeStyle {
  type: "arc";
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  anticlockwise?: boolean;
}

export interface PolylinePrimitive extends ShapeStyle {
  type: "polyline";
  points: readonly Vec[];
  closed?: boolean;
}

export interface RectPrimitive extends ShapeStyle {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

export interface TextPrimitive extends ShapeStyle {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: number;
  scale?: number;
  angle?: number;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom" | "alphabetic";
  aria?: string;
}

/** CSS screen coordinates; symbol and icon points use their local 24×24 frame. */
export type ScenePrimitive =
  | CirclePrimitive
  | ArcPrimitive
  | PolylinePrimitive
  | RectPrimitive
  | TextPrimitive;

export type SceneLayerId =
  | "background"
  | "base"
  | "portal"
  | "hubs"
  | "relations"
  | "labels"
  | "reading"
  | "loading";

export interface SceneLayer {
  id: SceneLayerId;
  order: number;
  primitives: ScenePrimitive[];
}

export interface MaskCircle {
  kind: "circle";
  cx: number;
  cy: number;
  radius: number;
}

export interface MaskPolyline {
  kind: "polyline";
  points: readonly Vec[];
  closed?: boolean;
}

export type MaskCurve = MaskCircle | MaskPolyline;

export interface SceneMask {
  id: string;
  visible: boolean;
  opacity: number;
  rule: "nonzero" | "evenodd";
  shapes: readonly MaskCurve[];
  outerRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fill?: string;
}

/** Hinge/position are on screen; offset, width and height precede the one scale. */
export interface LabelLayout {
  hinge: Vec;
  position: Vec;
  offset: Vec;
  degree: number;
  width: number;
  height: number;
  scale: number;
}

export interface LocalLabelFrame {
  attachment: FieldAttachment;
  visibility: number;
  phase: "entering" | "leaving" | "settled";
  pose: PagePose | null;
}

export interface LabelFrame {
  id: string;
  command: Command;
  aria: string;
  hubId: string;
  attachment?: FieldAttachment;
  glyph: string;
  visual: string;
  contentKind: LabelContentKind;
  layout: LabelLayout;
  opacity: number;
  interactive: boolean;
  localScrollHub?: string;
  icon?: FieldAttachment["icon"];
  symbolKind?: SymbolKind;
  symbolGeometry?: SymbolGeometry;
  symbolActivity?: number;
  resonating?: boolean;
  localPhase?: string;
  interaction?: {
    hover: boolean;
    focus: boolean;
    press: boolean;
    active: boolean;
  };
  page: PagePose | null;
  linkTarget?: string;
}

export interface ReadingFrame {
  id: string;
  chapterId: string;
  hubId: string;
  presentation: "circle" | "line";
  visible: boolean;
  inert: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  opacity: number;
  blur: number;
  rotationY: number;
  transformOrigin: Vec;
  anchorY: number;
  side: "left" | "right";
  clipEdge: "top" | "bottom" | "none";
  maskImage: string;
  textOffset: number;
  maxFloat: number;
  pointerEvents: "auto" | "none";
}

export interface PortalFrame {
  visible: boolean;
  opacity: number;
  fill: string;
  maskId: string;
  stroke?: {
    path: MaskCurve;
    color: string;
    opacity: number;
    width: number;
  };
  echo?: {
    path: MaskCurve;
    color: string;
    opacity: number;
    width: number;
  };
}

export interface BackgroundStreamline {
  points: readonly Vec[];
  marker: Vec;
  markerRadius: number;
  width: number;
  opacity: number;
  markerOpacity: number;
}

export interface BackgroundStar {
  at: Vec;
  radius: number;
  fill: string;
  opacity: number;
}

export interface BackgroundTrail {
  center: Vec;
  radius: number;
  startAngle: number;
  endAngle: number;
  width: number;
  opacity: number;
  color: string;
}

export interface BackgroundMeteor {
  from: Vec;
  to: Vec;
  head: Vec;
  headRadius: number;
  width: number;
  opacity: number;
  color: string;
}

export interface BackgroundFrame {
  mode: "none" | "flow" | "stars";
  theme: Theme;
  opacity: number;
  streamlines: BackgroundStreamline[];
  stars: BackgroundStar[];
  trails: BackgroundTrail[];
  meteors: BackgroundMeteor[];
}

export type HitGraspKind = "label" | "hub" | "reading" | "glyph";

export interface HitRect {
  type: "rect";
  /** Center of the rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise rotation in degrees. */
  rotation?: number;
}

export interface HitCircle {
  type: "circle";
  x: number;
  y: number;
  radius: number;
  /** A stroke band leaves the circle's interior available for panning. */
  strokeWidth?: number;
}

export interface HitPolyline {
  type: "polyline";
  points: readonly Vec[];
  tolerance: number;
  closed?: boolean;
}

export type HitShape = HitRect | HitCircle | HitPolyline;

export interface HitRegion {
  id: string;
  command: Command;
  aria?: string;
  hubId?: string;
  chapterId?: string;
  localScrollHub?: string;
  graspKind: HitGraspKind;
  shape: HitShape;
  /** Higher values win in a single CPU hit test. */
  priority: number;
}

export interface SceneFrame {
  /** Advance for geometry, labels or style changes; background may be replaced independently. */
  revision: number;
  rendererKind: ResolvedRendererKind;
  viewport: Viewport;
  camera: Camera;
  theme: Theme;
  visualTheme: Theme;
  layers: SceneLayer[];
  labels: LabelFrame[];
  masks: SceneMask[];
  portal: PortalFrame | null;
  reading: ReadingFrame[];
  hitRegions: HitRegion[];
  background: BackgroundFrame | null;
}

export interface GraphicsRenderer {
  readonly kind: ResolvedRendererKind;
  resize(width: number, height: number, dpr?: number): void;
  render(frame: SceneFrame): void;
  destroy(): void;
}

export function sceneLayer(
  id: SceneLayerId,
  order: number,
  primitives: ScenePrimitive[] = [],
): SceneLayer {
  return { id, order, primitives };
}

export function emptySceneFrame(
  rendererKind: ResolvedRendererKind,
  viewport: Viewport,
  camera: Camera,
  theme: Theme,
): SceneFrame {
  return {
    revision: 0,
    rendererKind,
    viewport: { ...viewport },
    camera: { ...camera },
    theme,
    visualTheme: theme,
    layers: [],
    labels: [],
    masks: [],
    portal: null,
    reading: [],
    hitRegions: [],
    background: null,
  };
}

function pointInRotatedRect(point: Vec, rect: HitRect): boolean {
  const angle = ((rect.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - rect.x;
  const dy = point.y - rect.y;
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return (
    Math.abs(localX) <= rect.width / 2 &&
    Math.abs(localY) <= rect.height / 2
  );
}

function distanceToSegment(point: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq),
  );
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

export function pointInHitRegion(point: Vec, region: HitRegion): boolean {
  const shape = region.shape;
  switch (shape.type) {
    case "rect":
      return pointInRotatedRect(point, shape);
    case "circle": {
      const distance = Math.hypot(point.x - shape.x, point.y - shape.y);
      return shape.strokeWidth === undefined ? distance <= shape.radius : Math.abs(distance - shape.radius) <= shape.strokeWidth / 2;
    }
    case "polyline": {
      const points = shape.points;
      if (!points.length) return false;
      const limit = points.length - (shape.closed ? 0 : 1);
      for (let i = 0; i < limit; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (distanceToSegment(point, a, b) <= shape.tolerance) return true;
      }
      return false;
    }
  }
}

/** Single CPU hit-test over the frame's semantic regions. */
export function hitTestFrame(
  frame: Pick<SceneFrame, "hitRegions">,
  point: Vec,
): HitRegion | null {
  let best: HitRegion | null = null;
  for (const region of frame.hitRegions) {
    if (!pointInHitRegion(point, region)) continue;
    if (
      !best ||
      region.priority > best.priority ||
      (region.priority === best.priority && region.id > best.id)
    ) {
      best = region;
    }
  }
  return best;
}

export function isHitRect(shape: HitShape): shape is HitRect {
  return shape.type === "rect";
}
