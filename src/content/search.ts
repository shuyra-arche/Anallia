import type { SearchIndexEntry } from "../core/content.ts";

export function stripReferences(text: string): string {
  return text.replace(/\{([^{}|]+)\|[^{}]+\}/g, "$1");
}

function normalize(text: string): string {
  return stripReferences(text);
}

export function buildSearchText(circle: string, line: string): string {
  return `${normalize(circle)} ${normalize(line)}`;
}

export function buildSearchHaystack(
  id: string,
  name: string,
  title: string,
  circle: string,
  line: string,
): string {
  return `${id} ${name} ${title} ${buildSearchText(circle, line)}`.toLowerCase();
}

/**
 * Store the body once as normalized search text. Metadata stays in the catalog
 * and is prefixed at query time; offsets describe the two presentation slices.
 */
export function buildSearchEntry(source: {
  id: string;
  name: string;
  title: string;
  circle: string;
  line: string;
}): SearchIndexEntry {
  const circleText = normalize(source.circle);
  const lineText = normalize(source.line);
  return {
    sourceId: source.id,
    searchText: `${circleText} ${lineText}`,
    circleStart: 0,
    circleEnd: circleText.length,
    lineStart: circleText.length + 1,
    lineEnd: circleText.length + 1 + lineText.length,
  };
}

export function searchEntryHaystack(
  entry: SearchIndexEntry,
  id: string,
  name: string,
  title: string,
): string {
  return `${id} ${name} ${title} ${entry.searchText}`.toLowerCase();
}

export function updateSearchEntry(
  entry: SearchIndexEntry,
  presentation: "circle" | "line",
  text: string,
): SearchIndexEntry {
  const start =
    presentation === "circle" ? entry.circleStart : entry.lineStart;
  const end = presentation === "circle" ? entry.circleEnd : entry.lineEnd;
  const replacement = normalize(text);
  const delta = replacement.length - (end - start);
  entry.searchText =
    entry.searchText.slice(0, start) + replacement + entry.searchText.slice(end);
  if (presentation === "circle") {
    entry.circleEnd = start + replacement.length;
    entry.lineStart += delta;
    entry.lineEnd += delta;
  } else {
    entry.lineEnd = start + replacement.length;
  }
  return entry;
}
