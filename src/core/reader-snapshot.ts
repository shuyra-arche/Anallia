import type { ContentDocument, ReaderDefinition } from "./content.ts";
import type { ReaderAnchor, ReaderOptions, ReaderSnapshot } from "./reader.ts";

const kinds = new Set(["paragraph", "horizontal-list", "vertical-list", "icons"]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate before changing a host, and detach all caller-owned input. */
export function readReaderSnapshot(value: unknown, definition: ReaderDefinition): ReaderSnapshot {
  const invalid = () => new TypeError("Invalid reader snapshot");
  if (!record(value) || value.version !== 1 || !record(value.location)) throw invalid();
  const { hub, chapter, presentation } = value.location;
  if (typeof hub !== "string" || typeof chapter !== "string" ||
    presentation !== "circle" && presentation !== "line" ||
    !definition.manifest.definitions.some(item => item.id === hub) ||
    !definition.manifest.chapters.some(item => item.id === chapter && item.hub === hub)) throw invalid();
  let anchor: ReaderAnchor | null = null;
  if (value.anchor !== null) {
    const a = value.anchor;
    if (!record(a) || typeof a.kind !== "string" || !kinds.has(a.kind) ||
      typeof a.text !== "string" || !a.text.trim() || a.text.length > 65536 ||
      typeof a.offset !== "number" || !Number.isSafeInteger(a.offset) || a.offset < 0 || a.offset >= a.text.length) throw invalid();
    anchor = Object.freeze({ kind: a.kind as ReaderAnchor["kind"], text: a.text, offset: a.offset });
  }
  return Object.freeze({ version: 1, location: Object.freeze({ hub, chapter, presentation }), anchor });
}

export function initialReaderSnapshot(definition: ReaderDefinition, options: ReaderOptions): ReaderSnapshot | null {
  if (options.restore === undefined) return null;
  if (options.chapter !== undefined || options.morph !== undefined)
    throw new TypeError("restore cannot be combined with chapter or morph");
  return readReaderSnapshot(options.restore, definition);
}

export function captureSessionAnchor(document: ContentDocument, source: number): ReaderAnchor | null {
  if (!document.complete || !Number.isSafeInteger(source) || source < 0) return null;
  const block = document.blocks.find(item => item.sourceStart <= source && source < item.sourceEnd);
  if (!block) return null;
  const text = document.source.slice(block.sourceStart, block.sourceEnd);
  if (!text.trim() || text.length > 65536 || document.blocks.filter(item =>
    item.kind === block.kind && document.source.slice(item.sourceStart, item.sourceEnd) === text).length !== 1) return null;
  return Object.freeze({ kind: block.kind, text, offset: source - block.sourceStart });
}

/** Only final content establishes uniqueness. Call once; never chase later replacements. */
export function resolveSessionAnchor(anchor: ReaderAnchor | null, document: ContentDocument): number | null {
  if (!anchor || !document.complete) return null;
  const matches = document.blocks.filter(item => item.kind === anchor.kind &&
    document.source.slice(item.sourceStart, item.sourceEnd) === anchor.text);
  return matches.length === 1 ? matches[0].sourceStart + anchor.offset : null;
}
