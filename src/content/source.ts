import type {
  ContentManifest,
  ContentSource,
  Presentation,
  TextPatch,
} from "../core/content.ts";
import { contentManifest } from "./generated/manifest.ts";
import { contentPartLoaders } from "./generated/part-loaders.ts";
import type { ContentPartLoaders } from "./types.ts";

export interface LocalContentSourceOptions {
  /** Maximum characters yielded per patch. Defaults to 48. */
  chunkSize?: number;
}

/**
 * Reads one hub part on demand. The part modules are loaded through dynamic
 * imports by generated/part-loaders.ts; no expression body is imported eagerly.
 */
export class LocalContentSource implements ContentSource {
  private readonly chapterHubs = new Map<string, string>();
  private readonly loaders: ContentPartLoaders;
  private readonly chunkSize: number;

  constructor(
    manifest: ContentManifest,
    loaders: ContentPartLoaders,
    options: LocalContentSourceOptions = {},
  ) {
    for (const chapter of manifest.chapters)
      this.chapterHubs.set(chapter.id, chapter.hub);
    this.loaders = loaders;
    const chunkSize = options.chunkSize ?? 48;
    if (!Number.isInteger(chunkSize) || chunkSize < 1)
      throw new Error("chunkSize must be a positive integer");
    this.chunkSize = chunkSize;
  }

  async *open(
    chapterId: string,
    presentation: Presentation,
    signal: AbortSignal,
  ): AsyncIterable<TextPatch> {
    if (signal.aborted) return;
    const hub = this.chapterHubs.get(chapterId);
    if (!hub) throw new Error(`Unknown content chapter: ${chapterId}`);
    const loader = this.loaders[hub];
    if (!loader) throw new Error(`No content source for hub: ${hub}`);
    const part = await loader();
    if (signal.aborted) return;
    const expressions = part[chapterId];
    if (!expressions)
      throw new Error(`Missing content expression: ${chapterId}`);
    const text = expressions[presentation];
    if (typeof text !== "string")
      throw new Error(
        `Missing ${presentation} expression: ${chapterId}`,
      );
    let cursor = 0;
    while (cursor < text.length) {
      if (signal.aborted) return;
      let end = Math.min(cursor + this.chunkSize, text.length);
      if (
        end < text.length &&
        text.charCodeAt(end - 1) >= 0xd800 &&
        text.charCodeAt(end - 1) <= 0xdbff
      )
        end++;
      yield { type: "append", text: text.slice(cursor, end) };
      cursor = end;
    }
  }
}

/** Production factory using the generated manifest and lazy hub parts. */
export function createLocalContentSource(
  options: LocalContentSourceOptions = {},
) {
  return new LocalContentSource(contentManifest, contentPartLoaders, options);
}
