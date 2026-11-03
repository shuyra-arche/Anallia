import type { ContentDocument } from "./content.ts";

export interface ContentBookmark { document: ContentDocument; source: number }
export type AnchorMatch = { kind: "matched"; source: number } | { kind: "unavailable" };

/** Positional block ids and percentages do not establish semantic equivalence.
 * Only identical complete documents or a unique, stable, exact block can transfer.
 * An incomplete target is evaluated once; later arrivals must not move the reader.
 */
export function matchContentAnchor(bookmark: ContentBookmark, target: ContentDocument): AnchorMatch {
  const { document: from, source } = bookmark;
  if (!Number.isFinite(source) || source < 0 || source > from.source.length) return { kind: "unavailable" };
  if (from.complete && target.complete && from.source === target.source)
    return { kind: "matched", source };
  const block = from.blocks.find(block => block.sourceStart <= source && source <= block.sourceEnd);
  if (!block || !(from.complete || block.stable)) return { kind: "unavailable" };
  const text = from.source.slice(block.sourceStart, block.sourceEnd);
  if (!text.trim()) return { kind: "unavailable" };
  const same = (document: ContentDocument) => document.blocks.filter(candidate =>
    candidate.kind === block.kind && document.source.slice(candidate.sourceStart, candidate.sourceEnd) === text);
  const matches = same(target);
  if (same(from).length !== 1 || matches.length !== 1 || !(target.complete || matches[0].stable))
    return { kind: "unavailable" };
  return { kind: "matched", source: matches[0].sourceStart + source - block.sourceStart };
}

export function presentationAnchor(
  current: ContentBookmark | null,
  previousTarget: ContentBookmark | null,
  target: ContentDocument,
): { source: number; reason: "matched" | "bookmark" | "start" } {
  for (const [bookmark, reason] of [[current, "matched"], [previousTarget, "bookmark"]] as const) {
    if (!bookmark) continue;
    const match = matchContentAnchor(bookmark, target);
    if (match.kind === "matched") return { source: match.source, reason };
  }
  return { source: 0, reason: "start" };
}
