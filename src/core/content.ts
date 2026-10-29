/** Shared content model. Runtime implementations live in src/content/. */
export type Presentation = "circle" | "line";

export interface TextPatch {
  type: "append" | "replace";
  text: string;
}

export interface ContentSource {
  open(
    chapterId: string,
    presentation: Presentation,
    signal: AbortSignal,
  ): AsyncIterable<TextPatch>;
}

export type ContentStatus =
  | "idle"
  | "loading"
  | "streaming"
  | "complete"
  | "error"
  | "cancelled";

export interface ContentSnapshot {
  text: string;
  version: number;
  complete: boolean;
  status: ContentStatus;
  error: Error | null;
}

export interface ContentChange extends ContentSnapshot {
  id: string;
  presentation: Presentation;
}

/**
 * The flush result is an array for convenient iteration, with a `changes`
 * alias for callers that prefer a named snapshot field.
 */
export interface ContentFlush extends Array<ContentChange> {
  changes: ContentChange[];
}

export interface ContentRequest {
  ready: Promise<void>;
  done: Promise<void>;
  cancel(): void;
}

export type ContentBlockKind =
  | "paragraph"
  | "horizontal-list"
  | "vertical-list"
  | "icons";

export interface TextInline {
  type: "text";
  text: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface ReferenceInline {
  type: "reference";
  text: string;
  target: string;
  sourceStart: number;
  sourceEnd: number;
  blockId: string;
}

export type Inline = TextInline | ReferenceInline;

export interface ContentListItem {
  sourceStart: number;
  sourceEnd: number;
  inline: Inline[];
  key?: string;
  value?: string;
  options?: ContentListItem[];
}

export interface ContentBlock {
  id: string;
  kind: ContentBlockKind;
  sourceStart: number;
  sourceEnd: number;
  stable: boolean;
  inline: Inline[];
  /** Present for list blocks; non-enumerable on parsed documents. */
  items?: ContentListItem[];
}

export interface ContentDocument {
  blocks: ContentBlock[];
  references: ReferenceInline[];
  /** Non-enumerable source/complete metadata for incremental callers. */
  readonly source: string;
  readonly complete: boolean;
}

/**
 * A compact full-text index entry. It stores one normalized search copy of the
 * authored body, not separate circle/line copies plus a concatenated haystack.
 * Offsets let complete expression updates replace just one presentation.
 */
export interface SearchIndexEntry {
  sourceId: string;
  searchText: string;
  circleStart: number;
  circleEnd: number;
  lineStart: number;
  lineEnd: number;
}

export interface ManifestChapter {
  id: string;
  name: string;
  parent: string | null;
  title: string;
  hub: string;
  refs: { glyph: string; target: string }[];
  /** Inline targets collected from the author text at generation time. */
  inlineTargets?: string[];
}

export interface ContentManifest {
  format: 1;
  definitions: import("./types.ts").HubDefinition[];
  chapters: ManifestChapter[];
  searchIndex: SearchIndexEntry[];
}
