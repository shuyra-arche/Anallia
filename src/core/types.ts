import type { FrameRate } from "./frame-rate.ts";
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
}
export interface Hub extends HubDefinition {
  targetMorph: number;
  fold: number;
  scroll: number;
  scrollTarget: number;
  path: string[];
}
export interface Settings {
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
    { path: string[]; scroll: number; target: number; morph: number }
  >;
}
export interface Passage {
  source: string;
  target: string;
  theme: Theme;
  started: number;
  duration: number;
  phase: number;
  commit: () => void;
  committed: boolean;
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
  | { type: "search"; query: string }
  | { type: "up" | "back" | "overview" | "loading" | "close-loading" };
