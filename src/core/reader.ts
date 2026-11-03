import type { Command, Settings, Theme } from "./types.ts";

/** Initial values only; runtime state remains owned by the reader. */
export interface ReaderOptions {
  chapter?: string;
  morph?: number;
  theme?: Theme;
  renderer?: "svg" | "webgl" | "auto";
  settings?: Partial<Settings>;
}
export type ReaderCommand = Exclude<
  Command,
  { type: "set-reading-layout" | "scroll-local" | "float-text" }
>;
export interface ReaderHandle {
  /** One-time readiness outcome, not a live state subscription. */
  readonly ready: Promise<{ status: "ready" | "destroyed" }>;
  dispatch(command: ReaderCommand): void;
  destroy(): void;
}
