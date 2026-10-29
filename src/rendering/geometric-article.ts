import { isContentAction } from "../core/content-actions.ts";
import { prepareWithSegments, layoutWithLines } from "@chenglou/pretext";
import type { ContentBlock, ContentDocument, Inline } from "../core/content.ts";
import type { Camera, Hub, Viewport } from "../core/types.ts";
import { geometricReadingLines } from "../geometry/geometric-reading.ts";
import {
  captureReadingSelection,
  restoreReadingSelection,
  clearIndexedRanges,
  indexTextRange,
  indexElementRange,
  setBlockSourceRange,
} from "./reading-anchor.ts";

export interface GeometricRun {
  text: string;
  start: number;
  end: number;
  target?: string;
}
export interface BrokenRow {
  runs: GeometricRun[];
  blockId: string;
  heading: boolean;
}
export type BreakText = (
  text: string,
  font: string,
  width: number,
) => { start: number; end: number }[];

/** Pretext cursors count graphemes within segments, while source ranges count UTF-16 units. */
export const breakGeometricText: BreakText = (text, font, width) => {
  const prepared = prepareWithSegments(text, font, { whiteSpace: "pre-wrap" });
  if (prepared.segments.join("") !== text)
    throw new Error("Unsupported text normalization");
  const offsets = [0];
  for (const segment of prepared.segments)
    offsets.push(offsets.at(-1)! + segment.length);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const offsetAt = (cursor: {
    segmentIndex: number;
    graphemeIndex: number;
  }) => {
    const segment = prepared.segments[cursor.segmentIndex] ?? "";
    const units = Array.from(
      segmenter.segment(segment),
      (part) => part.segment,
    );
    return (
      offsets[cursor.segmentIndex] +
      units.slice(0, cursor.graphemeIndex).join("").length
    );
  };
  return layoutWithLines(prepared, width, 26).lines.map((line) => ({
    start: offsetAt(line.start),
    end: offsetAt(line.end),
  }));
};

/** Per-block caching keeps stable paragraphs out of the frame-by-frame measurement path. */
export class GeometricTextCache {
  private blocks = new WeakMap<
    ContentBlock,
    { key: string; rows: BrokenRow[] }
  >();
  private readonly breakText: BreakText;
  constructor(breakText: BreakText = breakGeometricText) {
    this.breakText = breakText;
  }
  layout(
    block: ContentBlock,
    font: string,
    width: number,
    fontVersion: string,
  ): BrokenRow[] {
    const key = JSON.stringify([font, width, fontVersion]);
    const cached = this.blocks.get(block);
    if (cached?.key === key) return cached.rows;
    const text = block.inline.map((inline) => inline.text).join("");
    const spans: { inline: Inline; start: number; end: number }[] = [];
    let offset = 0;
    for (const inline of block.inline) {
      spans.push({ inline, start: offset, end: offset + inline.text.length });
      offset += inline.text.length;
    }
    const rows = this.breakText(text, font, width).map(({ start, end }) => ({
      blockId: block.id,
      heading: false,
      runs: spans.flatMap((span) => {
        const lo = Math.max(start, span.start),
          hi = Math.min(end, span.end);
        if (hi <= lo) return [];
        const inline = span.inline;
        return [
          {
            text: text.slice(lo, hi),
            start:
              inline.type === "text"
                ? inline.sourceStart + lo - span.start
                : inline.sourceStart,
            end:
              inline.type === "text"
                ? inline.sourceStart + hi - span.start
                : inline.sourceEnd,
            ...(inline.type === "reference" ? { target: inline.target } : {}),
          },
        ];
      }),
    }));
    this.blocks.set(block, { key, rows });
    return rows;
  }
}

interface ArticleRows {
  root: HTMLElement;
  signature: string;
  rows: BrokenRow[];
  title: string;
  titleBlock: ContentBlock;
  layoutKey: string;
}

export class GeometricArticle {
  private readonly cache = new GeometricTextCache();
  private readonly states = new WeakMap<HTMLElement, ArticleRows>();
  private readonly chapterExists: (target: string) => boolean;
  constructor(chapterExists: (target: string) => boolean) {
    this.chapterExists = chapterExists;
  }

  firstSource(article: HTMLElement): number | undefined {
    return this.states.get(article)?.rows.find((row) => !row.heading)?.runs[0]
      ?.start;
  }

  render(
    article: HTMLElement,
    document: ContentDocument,
    title: string,
    geometry: { hub: Hub; camera: Camera; viewport: Viewport; startS: number },
    width: number,
    offset: number,
    fontVersion: string,
    source?: number,
  ): { maxFloat: number; textOffset: number } | null {
    if (
      !document.blocks.length ||
      document.blocks.some((block) => block.kind !== "paragraph")
    )
      return null;
    const { hub, camera, viewport } = geometry;
    const z = camera.z;
    // A nearly horizontal spine cannot carry distinct horizontal rows legibly.
    if (
      Math.abs(1 - (hub.morph + (2 - hub.morph) * hub.fold)) < 1e-4 &&
      Math.abs(Math.cos(((hub.angle + camera.rotation) * Math.PI) / 180)) < 0.5
    )
      return null;
    let state = this.states.get(article);
    if (!state) {
      const root = article.ownerDocument.createElement("div");
      root.className = "geometric-content";
      article.append(root);
      state = {
        root,
        signature: "",
        rows: [],
        title: "",
        titleBlock: null!,
        layoutKey: "",
      };
      this.states.set(article, state);
    }
    if (state.title !== title) {
      state.title = title;
      state.titleBlock = {
        id: "geometric-title",
        kind: "paragraph",
        sourceStart: 0,
        sourceEnd: 0,
        stable: true,
        inline: [{ type: "text", text: title, sourceStart: 0, sourceEnd: 0 }],
      };
    }
    const probe = article.querySelector<HTMLElement>(".note-content p")!;
    const computed = article.ownerDocument.defaultView?.getComputedStyle(
      probe ?? article,
    );
    const family = computed?.fontFamily || "sans-serif";
    const font = `14px ${family}`;
    const lineHeight = 30;
    let rows: BrokenRow[];
    try {
      rows = [
        ...this.cache
          .layout(state.titleBlock, `600 16px ${family}`, width, fontVersion)
          .map((row) => ({ ...row, heading: true })),
        ...document.blocks.flatMap((block) =>
          this.cache.layout(block, font, width, fontVersion),
        ),
      ];
    } catch {
      return null;
    }
    const limit = Math.max(
      1,
      Math.min(
        14,
        Math.floor(
          Math.min(viewport.height * 0.65, 1.1 * 195 * z) / (lineHeight * z),
        ),
      ),
    );
    const candidates = geometricReadingLines({
      ...geometry,
      lineCount: Math.min(rows.length, limit),
      lineSpacing: lineHeight * z,
      offset: (76 + width / 2) * z,
      maxWidth: width * z,
    });
    const fits = (row: (typeof candidates)[number]) =>
      row.availableWidth + 1 >= width * z &&
      row.anchor.y >= lineHeight * z &&
      row.anchor.y <= viewport.height - lineHeight * z;
    const firstOutside = candidates.findIndex((row) => !fits(row));
    const capacity = firstOutside < 0 ? candidates.length : firstOutside;
    if (!capacity) return null;
    const maxFloat = Math.max(0, rows.length - capacity) * lineHeight;
    const layoutKey = JSON.stringify([width, font, fontVersion]);
    const readingSource =
      source ??
      (state.layoutKey !== layoutKey ? this.firstSource(article) : undefined);
    const sourceRow =
      readingSource === undefined
        ? -1
        : readingSource === 0
          ? 0
          : rows.findIndex(
              (row) =>
                !row.heading && row.runs.some((run) => run.end > readingSource),
            );
    const start = Math.min(
      Math.max(0, sourceRow >= 0 ? sourceRow : Math.floor(offset / lineHeight)),
      Math.max(0, rows.length - capacity),
    );
    state.layoutKey = layoutKey;
    const visible = rows.slice(start, start + capacity);
    const poses = candidates.slice(0, visible.length);
    const signature = JSON.stringify([visible, font, width, fontVersion]);
    if (state.signature !== signature) {
      const selection = captureReadingSelection(state.root);
      clearIndexedRanges(state.root);
      state.root.replaceChildren(
        ...visible.map((row) => {
          const element = article.ownerDocument.createElement(
            row.heading ? "h2" : "div",
          );
          element.className = "geometric-row";
          element.setAttribute("role", row.heading ? "heading" : "paragraph");
          if (row.heading) element.setAttribute("aria-level", "2");
          if (!row.heading)
            setBlockSourceRange(
              element,
              row.blockId,
              row.runs[0]?.start ?? 0,
              row.runs.at(-1)?.end ?? 0,
            );
          for (const run of row.runs) {
            if (
              run.target &&
              (isContentAction(run.target) || this.chapterExists(run.target))
            ) {
              const button = article.ownerDocument.createElement("button");
              button.className = "inline-ref";
              button.type = "button";
              button.dataset.target = run.target;
              button.dataset.refId = run.target;
              button.textContent = run.text;
              element.append(button);
              indexElementRange(
                state!.root,
                button,
                run.start,
                run.end,
                row.blockId,
              );
            } else {
              const text = article.ownerDocument.createTextNode(run.text);
              element.append(text);
              if (!row.heading)
                indexTextRange(
                  state!.root,
                  text,
                  run.start,
                  run.end,
                  row.blockId,
                );
            }
          }
          return element;
        }),
      );
      if (selection) restoreReadingSelection(state.root, selection);
      state.signature = signature;
    }
    state.root.style.fontFamily = family;
    state.rows = visible;
    Array.from(state.root.children).forEach((child, index) => {
      const row = child as HTMLElement,
        pose = poses[index];
      const transform = `translate(${pose.anchor.x}px,${pose.anchor.y}px) rotate(${pose.baselineAngle}deg) scale(${z}) translate(-50%,-50%)`;
      if (row.style.transform !== transform) row.style.transform = transform;
      row.style.width = `${width}px`;
      row.dataset.baselineAngle = String(pose.baselineAngle);
    });
    return {
      maxFloat,
      textOffset:
        readingSource === undefined
          ? Math.min(offset, maxFloat)
          : start * lineHeight,
    };
  }
}
