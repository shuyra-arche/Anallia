import { geometricReadingLines } from "../geometry/geometric-reading.ts";
import type { GeometricReadingLine, GeometricReadingRequest } from "../geometry/geometric-reading.ts";

export interface StaticTextLine {
  content: string;
  /** Half-open UTF-16 offsets in the original source. */
  sourceRange: { start: number; end: number };
}

export interface GeometricTextLine extends GeometricReadingLine, StaticTextLine {}

/** Assign pre-broken text to geometry without measuring, reordering or truncating it. */
export function layoutGeometricText(
  lines: readonly StaticTextLine[],
  geometry: Omit<GeometricReadingRequest, "lineCount">,
): GeometricTextLine[] {
  let previousEnd = 0;
  for (const { sourceRange: { start, end } } of lines) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < previousEnd || end < start) {
      throw new RangeError("Static text lines require ordered, non-overlapping source ranges");
    }
    previousEnd = end;
  }
  return geometricReadingLines({ ...geometry, lineCount: lines.length }).map((row, index) => ({
    ...row,
    content: lines[index].content,
    sourceRange: { ...lines[index].sourceRange },
  }));
}
