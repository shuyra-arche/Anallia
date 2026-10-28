import type { FrameRate } from "./frame-rate.ts";
import type { BackgroundMode } from "./background.ts";
export interface Vec {
  x: number;
  y: number;
}
export type Theme = "light" | "dark" | "obsidian";
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
  parent: string | null;
  title: string;
  expressions: { circle: string; line: string };
  refs: { glyph: string; target: string }[];
  children: string[];
  hub: string;
}
export interface HubDefinition {
  kind?: "search";
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
}
export interface Snapshot {
  searchQuery: string;
  focus: string;
  overview: boolean;
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
    }
  >;
}
export type TransitionKind = "near" | "flight" | "remote" | "axis" | "loading";
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
export interface FieldState {
  hubs: Record<string, Hub>;
  focus: string;
  overview: boolean;
  theme: Theme;
  camera: Camera;
  viewport: Viewport;
  settings: Settings;
  history: Snapshot[];
  passage: Passage | null;
  morphTurn: MorphTurn | null;
  contentTurn: ContentTurn | null;
  loading: boolean;
  description: string;
  elapsed: number;
  searchQuery: string;
  searchResults: string[];
}
export type Command =
  | { type: "navigate"; target: string }
  | { type: "focus"; hub: string }
  | { type: "morph" }
  | { type: "step"; delta: number }
  | { type: "scroll-local"; delta: number }
  | { type: "float-text"; delta: number; maxOffset?: number }
  | { type: "search"; query: string }
  | { type: "up" | "back" | "overview" | "loading" | "close-loading" };
