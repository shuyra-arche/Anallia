import type { Presentation } from "./content.ts";
import type { ReadingLayoutMode, Theme, Vec } from "./types.ts";

export type StaticBody = string | { readonly circle: string; readonly line: string };
export interface StaticChapter {
  readonly id: string;
  readonly hub: string;
  readonly title: string;
  readonly body: StaticBody;
  /** Omit for the hub's root; children name their parent explicitly. */
  readonly parent?: string | null;
  /** Short geometric label; defaults to the stable chapter ID. */
  readonly name?: string;
  readonly refs?: readonly { readonly label: string; readonly target: string }[];
  readonly boundaryRoutes?: { readonly previous?: string; readonly next?: string };
}
export interface StaticHub {
  readonly id: string;
  /** Defaults to this hub's sole parentless chapter. */
  readonly root?: string;
  readonly glyph?: string;
  readonly theme?: Theme;
  readonly center?: Readonly<Vec>;
  readonly angle?: number;
  readonly presentation?: Presentation;
  readonly readingLayoutMode?: ReadingLayoutMode;
  readonly parentHub?: string;
  readonly kind?: "search" | "settings";
  readonly layout?: "anchored";
  readonly recommendations?: readonly string[];
}
export interface StaticReaderInput {
  readonly title?: string;
  readonly entry: string;
  readonly hubs: readonly StaticHub[];
  /** Array order controls sibling order, never identity. */
  readonly chapters: readonly StaticChapter[];
}
export interface ContentBuildIssue {
  readonly code: "shape" | "id" | "duplicate" | "reference" | "ownership" | "cycle" | "root" | "capability";
  readonly path: string;
  readonly message: string;
  /** One-based position in the indicated body expression, when applicable. */
  readonly line?: number;
  readonly column?: number;
}
