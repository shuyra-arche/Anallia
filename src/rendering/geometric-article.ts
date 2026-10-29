import {
  circularReadingPose,
  circularReadingOpacity,
  circularReadingSlots,
  READING_LINE_STEP,
} from "../geometry/circular-reading.ts";
import { isContentAction } from "../core/content-actions.ts";
import { prepareWithSegments, layoutWithLines } from "@chenglou/pretext";
import type { ContentBlock, ContentDocument, Inline } from "../core/content.ts";
import type { Camera, Hub, Viewport } from "../core/types.ts";
import { R } from "../geometry/field.ts";
import { worldToScreen } from "../geometry/field.ts";
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
  width?: number;
}
export type BreakText = (
  text: string,
  font: string,
  width: number,
) => { start: number; end: number; width?: number }[];

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
    width: line.width,
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
    let consumed = 0;
    const ranges = this.breakText(text, font, width).flatMap((range) => {
      const start = Math.max(consumed, range.start);
      let end = range.end;
      if (end <= start) return [];
      for (const span of spans)
        if (
          span.inline.type === "reference" &&
          span.start < end &&
          end < span.end
        )
          end = span.end;
      consumed = end;
      const measuredWidth =
        start === range.start && end === range.end
          ? range.width
          : this.breakText(
              text.slice(start, end),
              font,
              Number.MAX_SAFE_INTEGER,
            )[0]?.width;
      return [{ start, end, width: measuredWidth }];
    });
    const rows = ranges.map(({ start, end, width }) => ({
      blockId: block.id,
      heading: false,
      width,
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
  activeSource?: number;
  circleActive?: boolean;
  circle?: {
    document: ContentDocument;
    key: string;
    rows: BrokenRow[];
    nodes: Map<number, HTMLElement>;
  };
}

export class GeometricArticle {
  private readonly cache = new GeometricTextCache();
  private readonly states = new WeakMap<HTMLElement, ArticleRows>();
  private readonly chapterExists: (target: string) => boolean;
  constructor(chapterExists: (target: string) => boolean) {
    this.chapterExists = chapterExists;
  }

  firstSource(article: HTMLElement): number | undefined {
    const state = this.states.get(article);
    return (
      state?.activeSource ??
      state?.rows.find((row) => !row.heading)?.runs[0]?.start
    );
  }

  private renderCircle(
    article: HTMLElement,
    state: ArticleRows,
    document: ContentDocument,
    geometry: {
      hub: Hub;
      camera: Camera;
      viewport: Viewport;
      startS: number;
      bottomInset?: number;
    },
    family: string,
    fontVersion: string,
    width: number,
    offset: number,
    source?: number,
  ): { maxFloat: number; textOffset: number; readingRows?: number } | null {
    const key = JSON.stringify([family, fontVersion, width, state.title]);
    let readingSource = source;
    if (
      !state.circle ||
      state.circle.document !== document ||
      state.circle.key !== key
    ) {
      readingSource ??= state.activeSource;
      let rows: BrokenRow[];
      try {
        rows = [
          ...this.cache
            .layout(state.titleBlock, `600 16px ${family}`, width, fontVersion)
            .map((row) => ({ ...row, heading: true })),
          ...document.blocks.flatMap((block) =>
            this.cache.layout(block, `14px ${family}`, width, fontVersion),
          ),
        ];
      } catch {
        return null;
      }
      clearIndexedRanges(state.root);
      state.root.replaceChildren();
      state.circle = { document, key, rows, nodes: new Map() };
      state.signature = "";
    }
    const { rows, nodes } = state.circle;
    if (!state.circleActive) {
      clearIndexedRanges(state.root);
      state.root.replaceChildren();
      nodes.clear();
    }
    state.circleActive = true;
    const maxFloat = Math.max(0, rows.length - 1) * READING_LINE_STEP;
    const sourceRow =
      readingSource === undefined
        ? -1
        : readingSource === 0
          ? 0
          : rows.findIndex(
              (row) =>
                !row.heading &&
                row.runs.some((run) => run.end > readingSource!),
            );
    const textOffset = Math.max(
      0,
      Math.min(
        maxFloat,
        sourceRow >= 0 ? sourceRow * READING_LINE_STEP : offset,
      ),
    );
    const progress = textOffset / READING_LINE_STEP;
    const { hub, camera, viewport, startS } = geometry;
    const slots = circularReadingSlots(Math.max(1, rows.length));
    const lineAngle = 2 * Math.PI / slots;
    const first = Math.max(0, Math.floor(progress) - 1),
      last = Math.min(rows.length - 1, Math.floor(progress) + slots);
    const visible = new Set<number>();
    let order = 0;
    for (let index = first; index <= last; index++) {
      const opacity = circularReadingOpacity(index, progress, slots);
      if (opacity <= 0.001) continue;
      visible.add(index);
      const row = rows[index],
        pose = circularReadingPose(hub, startS, index, R + 76 + width / 2, lineAngle);
      const anchor = worldToScreen(pose.point, camera, viewport);
      let element = nodes.get(index);
      if (!element) {
        element = article.ownerDocument.createElement(
          row.heading ? "h2" : "div",
        );
        element.className = "geometric-row circular-row";
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
            button.type = "button";
            button.className = "inline-ref";
            button.dataset.target = button.dataset.refId = run.target;
            button.textContent = run.text;
            element.append(button);
            indexElementRange(
              state.root,
              button,
              run.start,
              run.end,
              row.blockId,
            );
          } else {
            const text = article.ownerDocument.createTextNode(run.text);
            element.append(text);
            if (!row.heading)
              indexTextRange(state.root, text, run.start, run.end, row.blockId);
          }
        }
        nodes.set(index, element);
      }
      const at = state.root.children[order++] ?? null;
      if (at !== element) state.root.insertBefore(element, at);
      const angle =
        ((((pose.baselineAngle + camera.rotation + 90) % 180) + 180) % 180) -
        90;
      element.style.width = `${width}px`;
      element.style.transform = `translate(${anchor.x}px,${anchor.y}px) rotate(${angle}deg) scale(${camera.z}) translate(-50%,-50%)`;
      element.style.opacity = String(opacity);
      element.inert = opacity < 0.45;
      element.dataset.baselineAngle = String(angle);
      element.dataset.readingRow = String(index);
    }
    for (const [index, node] of nodes)
      if (!visible.has(index)) {
        clearIndexedRanges(state.root, node);
        node.remove();
        nodes.delete(index);
      }
    state.rows = [...visible].map((index) => rows[index]);
    state.activeSource =
      rows.slice(Math.floor(progress)).find((row) => !row.heading)?.runs[0]
        ?.start ?? 0;
    state.root.style.fontFamily = family;
    state.root.style.position = "absolute";
    state.root.style.width = `${viewport.width}px`;
    state.root.style.height = `${viewport.height}px`;
    state.root.style.clipPath = `inset(0 0 ${geometry.bottomInset ?? 0}px 0)`;
    state.root.dataset.readingSource = String(state.activeSource);
    state.root.dataset.readingProgress = String(progress);
    state.root.dataset.readingSlots = String(slots);
    state.root.dataset.readingRows = String(rows.length);
    return { maxFloat, textOffset, readingRows: rows.length };
  }

  render(
    article: HTMLElement,
    document: ContentDocument,
    title: string,
    geometry: {
      hub: Hub;
      camera: Camera;
      viewport: Viewport;
      startS: number;
      bottomInset?: number;
    },
    width: number,
    offset: number,
    fontVersion: string,
    source?: number,
  ): { maxFloat: number; textOffset: number; readingRows?: number } | null {
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
    if (hub.morph < 0.0001 && hub.fold === 0)
      return this.renderCircle(
        article,
        state,
        document,
        geometry,
        family,
        fontVersion,
        width,
        offset,
        source,
      );
    if (state.circleActive) {
      state.circleActive = false;
      clearIndexedRanges(state.root);
      state.root.replaceChildren();
      state.circle?.nodes.clear();
      state.signature = "";
      state.activeSource = undefined;
      state.root.style.clipPath = "none";
    }
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
