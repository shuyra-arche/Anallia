import type { FrameRate } from "./frame-rate.ts";
import type { BackgroundMode } from "./background.ts";
export interface Vec {
  x: number;
  y: number;
}
export type Theme =
  | "light"
  | "parchment"
  | "celadon"
  | "rosewood"
  | "ivory"
  | "dark"
  | "obsidian"
  | "abyss";
export interface Camera extends Vec {
  z: number;
  rotation: number;
}
export interface Viewport {
  width: number;
  height: number;
}
export type ContentRow = [
  id: string,
  name: string,
  parent: string | null,
  title: string,
  circle: string,
  line: string,
  refs: [string, string][],
];
export interface Chapter {
  id: string;
  name: string;
  parent: string | null,
  title: string;
  expressions: { circle: string; line: string };
  refs: { glyph: string; target: string }[];
  children: string[];
  hub: string;
}
export type ReadingLayoutMode = "window" | "geometric";

export interface HubDefinition {
  readingLayoutMode?: ReadingLayoutMode;
  /** Optional utility capability; independent of glyph, ID and chapter names. */
  kind?: "search" | "settings";
  layout?: "anchored";
  recommendations?: readonly string[];
  id: string;
  glyph: string;
  theme: Theme;
  center: Vec;
  angle: number;
  morph: number;
  root: string;
  /** Optional explicit recursive hub relation; never inferred from proximity. */
  parentHub?: string;
}
export interface Hub extends HubDefinition {
  readingLayoutMode: ReadingLayoutMode;
  /** Screen-space outward bearing chosen when approaching this hub. */
  readingBearing?: number;
  readingStart?: number;
  targetMorph: number;
  fold: number;
  scroll: number;
  scrollTarget: number;
  textOffset: number;
  textOffsetTarget: number;
  path: string[];
  /** Material arc-length shift: a content switch can preserve its actual hinge. */
  anchorOffset: number;
  localScroll: number;
  localScrollTarget: number;
}
export interface Settings {
  background: BackgroundMode;
  frameRate: FrameRate;
  speed: number;
  range: number;
  blur: number;
  reducedMotion: boolean;
  sound?: boolean;
}
export interface Snapshot {
  searchQuery: string;
  focus: string;
  overview: boolean;
  overviewPanel: "expanded" | "collapsed";
  viewport: Viewport;
  theme: Theme;
  camera: Camera;
  hubs: Record<
    string,
    {
      path: string[];
      scroll: number;
      target: number;
      morph: number;
      anchorOffset: number;
      angle: number;
      readingBearing?: number;
      readingStart?: number;
      textOffset?: number;
      textOffsetTarget?: number;
      localScroll?: number;
      localScrollTarget?: number;
    }
  >;
}
export type TransitionKind = "near" | "flight" | "remote" | "axis";
export interface PortalAnchor {
  center: Vec;
  angle: number;
  morph: number;
}
export interface Passage {
  kind: TransitionKind;
  direction: "forward" | "reverse";
  from: PortalAnchor;
  to: PortalAnchor;
  sourceTheme: Theme;
  source: string;
  target: string;
  theme: Theme;
  started: number;
  duration: number;
  phase: number;
  commit: () => void;
  committed: boolean;
}
/** The one transition which replaces content at a fixed material hinge. */
export interface ContentTurn {
  hub: string;
  from: string;
  to: string;
  started: number;
  duration: number;
  phase: number;
  direction: 1 | -1;
  commit: () => void;
  committed: boolean;
}
/** A complete, reversible page turn around points on the current Möbius hub. */
export interface MorphTurn {
  hub: string;
  from: number;
  to: number;
  started: number;
  duration: number;
  phase: number;
  /** Fixed viewport projection of the focused material point during the morph. */
  screenAnchor: Vec;
  startRotation: number;
}
/** Exactly one structural transition owns content/shape at a time. Camera tween is orthogonal. */
export type StructuralTransition =
  | { kind: "idle" }
  | { kind: "passage"; value: Passage }
  | { kind: "morph"; value: MorphTurn }
  | { kind: "content"; value: ContentTurn };

export interface FieldState {
  hubs: Record<string, Hub>;
  focus: string;
  overview: boolean;
  overviewPanel: "expanded" | "collapsed";
  theme: Theme;
  camera: Camera;
  viewport: Viewport;
  settings: Settings;
  history: Snapshot[];
  transition: StructuralTransition;
  /** Read-only projections for renderers; transition is the only stored owner. */
  readonly passage: Passage | null;
  readonly morphTurn: MorphTurn | null;
  readonly contentTurn: ContentTurn | null;
  loading: boolean;
  description: string;
  elapsed: number;
  searchQuery: string;
  searchResults: string[];
}
export type Command =
  | { type: "set-reading-layout"; hub: string; mode: ReadingLayoutMode }
  | { type: "navigate"; target: string }
  | { type: "focus"; hub: string }
  | { type: "morph" }
  | { type: "step"; delta: number }
  | { type: "scroll-local"; delta: number }
  | { type: "float-text"; delta: number; maxOffset?: number; clampOnly?: boolean }
  | { type: "search"; query: string }
  | { type: "up" | "back" | "overview" | "toggle-overview-map" };

export interface GraspReadingSnapshot {
  chapterId: string;
  camera: Camera;
  angle: number;
  readingBearing?: number;
  readingStart?: number;
  textOffset: number;
  textOffsetTarget: number;
  localScroll: number;
  localScrollTarget: number;
}
