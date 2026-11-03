import type { Command, Settings, Theme } from "./types.ts";
import type { ContentBlockKind, ContentStatus, Presentation } from "./content.ts";

export interface ReaderPlace {
  readonly hub: string;
  readonly chapter: string;
  readonly presentation: Presentation;
}
/** Exact, unique authored block plus a UTF-16 source offset; never pixels or DOM. */
export interface ReaderAnchor {
  readonly kind: ContentBlockKind;
  readonly text: string;
  readonly offset: number;
}
export interface ReaderSnapshot {
  readonly version: 1;
  readonly location: ReaderPlace;
  readonly anchor: ReaderAnchor | null;
}
export type ReaderRestoration = "none" | "pending" | "matched" | "start" | "cancelled";
export interface ReaderRequest {
  readonly location: ReaderPlace;
  readonly content: ContentStatus;
}
export type ReaderState =
  | { readonly status: "starting" | "destroyed" }
  | {
      readonly status: "active";
      readonly location: ReaderPlace;
      readonly view: "reading" | "overview";
      readonly readable: boolean;
      readonly motion: "idle" | "passage" | "morph" | "level";
      readonly content: ContentStatus;
      /** Foreground content request; may target a chapter not yet committed to Field. */
      readonly request: ReaderRequest | null;
      readonly restoration: ReaderRestoration;
    };
export type ReaderListener = (state: ReaderState) => void;

/** Initial values only; runtime state remains owned by the reader. */
export interface ReaderOptions {
  chapter?: string;
  morph?: number;
  theme?: Theme;
  renderer?: "svg" | "webgl" | "auto";
  settings?: Partial<Settings>;
  /** Explicit mount-time restoration. Mutually exclusive with chapter/morph. */
  restore?: ReaderSnapshot;
}
export type ReaderCommand = Exclude<
  Command,
  { type: "set-reading-layout" | "scroll-local" | "float-text" }
>;
export interface ReaderHandle {
  /** One-time readiness outcome, not a live state subscription. */
  readonly ready: Promise<{ status: "ready" | "destroyed" }>;
  dispatch(command: ReaderCommand): void;
  getState(): ReaderState;
  /** Immediately emits current state, then semantic changes; unsubscribe is idempotent. */
  subscribe(listener: ReaderListener): () => void;
  /** Null during loading, movement or ephemeral search results. No automatic storage. */
  snapshot(): ReaderSnapshot | null;
  destroy(): void;
}
