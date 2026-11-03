import {
  circularReadingPose,
  circularReadingOpacity,
  circularReadingSlots,
  READING_LINE_STEP,
  circularLyricsLayout,
  circularLyricsPose,
  circularLyricsOpacity,
} from "../geometry/circular-reading.ts";
import { isContentAction } from "../core/content-actions.ts";
import { prepareWithSegments, layoutWithLines } from "@chenglou/pretext";
import type { ContentBlock, ContentDocument, Inline } from "../core/content.ts";
import type { Camera, Hub, Viewport } from "../core/types.ts";
import { R, shapeU, worldToScreen } from "../geometry/field.ts";
import {
  geometricReadingLines,
  spineContourPoses,
} from "../geometry/geometric-reading.ts";
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

const CLOSING_PUNCT_RE = /^[。，、；：？！）》」』】”’.,!?;:)]+/;

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
    const rawRanges = this.breakText(text, font, width);
    const ranges = rawRanges.flatMap((range) => {
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
      // Kinsoku (避头点): never leave closing punctuation orphaned at the start of the next line
      if (rawRanges.length > 1 && end < text.length) {
        const trailingPunct = CLOSING_PUNCT_RE.exec(text.slice(end));
        if (trailingPunct) end += trailingPunct[0].length;
      }
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
                ? Math.min(inline.sourceEnd, inline.sourceStart + lo - span.start)
                : inline.sourceStart,
            end:
              inline.type === "text"
                ? Math.min(inline.sourceEnd, inline.sourceStart + hi - span.start)
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

/** Convert a horizontal-list block into a synthetic paragraph block for geometric rendering. */
function normalizeGeometricBlocks(
  blocks: readonly ContentBlock[],
  cacheMap: WeakMap<ContentBlock, ContentBlock>,
): ContentBlock[] | null {
  if (!blocks.length) return null;
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      out.push(block);
      continue;
    }
    if (block.kind === "horizontal-list" && block.items?.length) {
      let synth = cacheMap.get(block);
      if (!synth) {
        const inlines: Inline[] = [];
        block.items.forEach((item, idx) => {
          if (idx > 0) {
            const prevEnd = inlines.at(-1)?.sourceEnd ?? item.sourceStart;
            inlines.push({
              type: "text",
              text: "  ·  ",
              sourceStart: prevEnd,
              sourceEnd: prevEnd,
            });
          }
          for (const inline of item.inline) inlines.push(inline);
        });
        synth = {
          id: block.id,
          kind: "paragraph",
          sourceStart: block.sourceStart,
          sourceEnd: block.sourceEnd,
          stable: block.stable,
          inline: inlines,
        };
        cacheMap.set(block, synth);
      }
      out.push(synth);
      continue;
    }
    return null;
  }
  return out;
}

interface PooledRows {
  document: ContentDocument;
  key: string;
  rows: BrokenRow[];
  blockStarts: Set<number>;
  nodes: Map<number, HTMLElement>;
}

interface ArticleRows {
  root: HTMLElement;
  signature: string;
  rows: BrokenRow[];
  title: string;
  titleBlock: ContentBlock;
  layoutKey: string;
  activeSource?: number;
  mode?: "circle" | "spine";
  circle?: PooledRows;
  spine?: PooledRows;
}

export class GeometricArticle {
  private readonly cache = new GeometricTextCache();
  private readonly states = new WeakMap<HTMLElement, ArticleRows>();
  private readonly synthBlocks = new WeakMap<ContentBlock, ContentBlock>();
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

  private createRowElement(
    article: HTMLElement,
    root: HTMLElement,
    row: BrokenRow,
    className: string,
    withRole: boolean,
  ): HTMLElement {
    const element = article.ownerDocument.createElement(
      row.heading ? "h2" : "div",
    );
    element.className = className;
    if (withRole) {
      element.setAttribute("role", row.heading ? "heading" : "paragraph");
      if (row.heading) element.setAttribute("aria-level", "2");
    }
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
        indexElementRange(root, button, run.start, run.end, row.blockId);
      } else {
        const text = article.ownerDocument.createTextNode(run.text);
        element.append(text);
        if (!row.heading)
          indexTextRange(root, text, run.start, run.end, row.blockId);
      }
    }
    return element;
  }

  private renderCircle(
    article: HTMLElement,
    state: ArticleRows,
    document: ContentDocument,
    blocks: readonly ContentBlock[],
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
    const isRing = article.ownerDocument.documentElement.dataset.circleReadingMode === "ring";
    const measureWidth = isRing ? width : Math.min(
      width,
      geometry.viewport.width >= 900
        ? Math.max(220, Math.min(268, Math.round(geometry.viewport.width * 0.21)))
        : width,
    );
    const key = JSON.stringify([family, fontVersion, measureWidth, state.title]);
    let readingSource = source;
    let selection: ReturnType<typeof captureReadingSelection> = null;
    if (
      !state.circle ||
      state.circle.document !== document ||
      state.circle.key !== key
    ) {
      readingSource ??= state.activeSource;
      let rows: BrokenRow[];
      const blockStarts = new Set<number>();
      try {
        const titleRows = this.cache
          .layout(state.titleBlock, `600 16px ${family}`, measureWidth, fontVersion)
          .map((row) => ({ ...row, heading: true }));
        rows = [...titleRows];
        for (const block of blocks) {
          const startIdx = rows.length;
          const broken = this.cache.layout(
            block,
            `14px ${family}`,
            measureWidth,
            fontVersion,
          );
          if (broken.length > 0) blockStarts.add(startIdx);
          rows.push(...broken);
        }
      } catch {
        return null;
      }
      selection ??= captureReadingSelection(state.root);
      clearIndexedRanges(state.root);
      state.root.replaceChildren();
      state.circle = { document, key, rows, blockStarts, nodes: new Map() };
      state.signature = "";
    }
    const { rows, blockStarts, nodes } = state.circle;
    if (state.mode !== "circle") {
      selection ??= captureReadingSelection(state.root);
      clearIndexedRanges(state.root);
      state.root.replaceChildren();
      nodes.clear();
      state.spine?.nodes.clear();
      state.mode = "circle";
    }
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
    const bottomInset = geometry.bottomInset ?? 0;
    const layout = circularLyricsLayout(rows.length);
    const slots = isRing ? circularReadingSlots(rows.length) : layout.slots;
    const lineAngle = isRing ? 2 * Math.PI / slots : layout.lineAngle;
    // Dissolve window: rows up to 175° away (~35 lines at 5°/line) can be visible before overlap
    const maxVisibleDist = Math.ceil((175 * Math.PI) / (180 * lineAngle));
    const first = Math.max(0, isRing ? Math.floor(progress) - 1 : Math.floor(progress - maxVisibleDist));
    const last = Math.min(rows.length - 1, isRing ? Math.floor(progress) + slots : Math.ceil(progress + maxVisibleDist));
    const visible = new Set<number>();
    const rowRadius = R + 80 + measureWidth / 2;
    const widthPx = `${measureWidth}px`;
    let order = 0;
    for (let index = first; index <= last; index++) {
      const opacity = isRing
        ? circularReadingOpacity(index, progress, slots)
        : circularLyricsOpacity(index, progress, rows.length, slots);
      if (opacity <= 0.001) continue;
      visible.add(index);
      const row = rows[index];
      const pose = isRing
        ? circularReadingPose(hub, startS, index, rowRadius, lineAngle)
        : circularLyricsPose(
        hub,
        startS,
        index,
        progress,
        rowRadius,
        lineAngle,
      );
      const anchor = worldToScreen(pose.point, camera, viewport);
      let element = nodes.get(index);
      if (!element) {
        element = this.createRowElement(
          article,
          state.root,
          row,
          "geometric-row circular-row",
          false,
        );
        nodes.set(index, element);
      }
      const at = state.root.children[order++] ?? null;
      if (at !== element) state.root.insertBefore(element, at);
      const rawScreenDeg = pose.baselineAngle + camera.rotation;
      const rawScreenRad = (rawScreenDeg * Math.PI) / 180;
      const cosVal = Math.cos(rawScreenRad);
      const prevSide = element.dataset.hubSide;
      const flipped =
        prevSide === "right"
          ? cosVal < 0.02
          : prevSide === "left"
            ? cosVal < -0.02
            : cosVal < -1e-5;
      const angle =
        ((((rawScreenDeg + 90) % 180) + 180) % 180) - 90;
      const isActiveRow = Math.abs(index - progress) < 0.55;
      const nextAlign = flipped ? "right" : "left";
      const nextTransform = `translate(${anchor.x.toFixed(3)}px,${anchor.y.toFixed(3)}px) rotate(${angle.toFixed(6)}deg) scale(${camera.z}) translate(-50%,-50%)`;
      const nextOpacity = String(Math.round(opacity * 1000) / 1000);

      if (element.style.width !== widthPx) element.style.width = widthPx;
      if (element.style.textAlign !== nextAlign) element.style.textAlign = nextAlign;
      if (element.style.transform !== nextTransform) element.style.transform = nextTransform;
      if (element.style.opacity !== nextOpacity) element.style.opacity = nextOpacity;
      const nextInert = opacity < 0.35;
      if (Boolean(element.inert) !== nextInert) element.inert = nextInert;
      element.dataset.baselineAngle = String(angle);
      element.dataset.readingRow = String(index);
      element.dataset.hubSide = flipped ? "right" : "left";
      if (isActiveRow) element.dataset.activeRow = "true";
      else delete element.dataset.activeRow;
      if (blockStarts.has(index)) element.dataset.blockStart = "true";
      else delete element.dataset.blockStart;
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
    state.root.dataset.readingProgress = progress.toFixed(3);
    state.root.dataset.readingRows = String(rows.length);
    state.root.dataset.readingMax = maxFloat.toFixed(1);
    if (state.root.style.fontFamily !== family) state.root.style.fontFamily = family;
    state.root.style.position = "absolute";
    state.root.style.width = `${viewport.width}px`;
    state.root.style.height = `${viewport.height}px`;
    state.root.style.clipPath = `inset(0 0 ${bottomInset}px 0)`;
    if (bottomInset > 0) {
      const cutY = Math.max(0, viewport.height - bottomInset);
      const mask = `linear-gradient(to bottom, #000 0px, #000 ${Math.max(0, cutY - 22)}px, rgba(0,0,0,0) ${cutY}px)`;
      state.root.style.maskImage = mask;
      state.root.style.webkitMaskImage = mask;
    } else {
      state.root.style.maskImage = "none";
      state.root.style.webkitMaskImage = "none";
    }
    state.root.dataset.readingSource = String(state.activeSource);
    state.root.dataset.readingProgress = String(progress);
    state.root.dataset.readingSlots = String(slots);
    state.root.dataset.readingRows = String(rows.length);
    if (selection) restoreReadingSelection(state.root, selection);
    return { maxFloat, textOffset, ...(isRing ? { readingRows: rows.length } : {}) };
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
    const blocks = normalizeGeometricBlocks(document.blocks, this.synthBlocks);
    if (!blocks) return null;
    const { hub, camera, viewport } = geometry;
    const z = camera.z;
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
    const docEl = article.ownerDocument.documentElement;
    // For Circle hubs (hub.morph < 0.5 && hub.fold === 0):
    // Default to the Radial Lyric-Floating layout (renderCircle),
    // where text lines point radially to center and float like lyrics with stationary camera.
    if (
      hub.morph < 0.5 &&
      hub.fold === 0 &&
      docEl.dataset.circleReadingMode !== "spine"
    )
      return this.renderCircle(
        article,
        state,
        document,
        blocks,
        geometry,
        family,
        fontVersion,
        width,
        offset,
        source,
      );
    let selection: ReturnType<typeof captureReadingSelection> = null;
    if (state.mode !== "spine") {
      selection ??= captureReadingSelection(state.root);
      clearIndexedRanges(state.root);
      state.root.replaceChildren();
      state.circle?.nodes.clear();
      state.spine?.nodes.clear();
      state.signature = "";
      state.activeSource = undefined;
      state.mode = "spine";
    }
    const lineHeight = 30;
    const bottomInset = geometry.bottomInset ?? 0;
    const rightInset =
      docEl.dataset.demo === "leaves-ix" && viewport.width > 900 ? 196 : 0;
    const u = shapeU(hub);
    const isCircle = u < 0.5;
    const isLine = Math.abs(1 - u) < 1e-4;
    const effectiveLineWidth = Math.max(
      180,
      Math.min(
        width,
        Math.round((viewport.width - rightInset) * (isCircle ? 0.36 : 0.42)),
      ),
    );
    const spineKey = JSON.stringify([family, fontVersion, effectiveLineWidth, state.title, isCircle]);
    if (
      !state.spine ||
      state.spine.document !== document ||
      state.spine.key !== spineKey
    ) {
      let rows: BrokenRow[];
      const blockStarts = new Set<number>();
      try {
        const titleRows = this.cache
          .layout(
            state.titleBlock,
            `600 16px ${family}`,
            effectiveLineWidth,
            fontVersion,
          )
          .map((row) => ({ ...row, heading: true }));
        rows = [...titleRows];
        for (const block of blocks) {
          const startIdx = rows.length;
          const broken = this.cache.layout(
            block,
            font,
            effectiveLineWidth,
            fontVersion,
          );
          if (broken.length > 0) blockStarts.add(startIdx);
          rows.push(...broken);
        }
      } catch {
        return null;
      }
      selection ??= captureReadingSelection(state.root);
      clearIndexedRanges(state.root);
      state.root.replaceChildren();
      state.spine = { document, key: spineKey, rows, blockStarts, nodes: new Map() };
    }
    const { rows, blockStarts, nodes } = state.spine;

    const usableHeight = Math.max(
      lineHeight * z * 2,
      viewport.height - bottomInset - 56 * z,
    );
    const limit = Math.max(
      2,
      Math.min(
        isCircle ? 14 : 15,
        Math.floor(
          Math.min(
            usableHeight * (isCircle ? 0.82 : 0.78),
            (isCircle ? 1.75 : 1.25) * 220 * z,
          ) /
            (lineHeight * z),
        ),
      ),
    );

    const capacity = Math.min(rows.length, limit);
    if (!capacity) return null;

    const maxFloat = Math.max(0, rows.length - capacity) * lineHeight;
    const layoutKey = JSON.stringify([effectiveLineWidth, font, fontVersion]);
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
    const clampedOffset = clampOffset(
      sourceRow >= 0 ? sourceRow * lineHeight : offset,
      0,
      maxFloat,
    );
    const start = Math.min(
      Math.max(0, Math.floor(clampedOffset / lineHeight)),
      Math.max(0, rows.length - capacity),
    );
    const subLineOffset = clampedOffset - start * lineHeight;
    state.layoutKey = layoutKey;
    const visibleCount =
      subLineOffset > 0.5 && start + capacity < rows.length
        ? capacity + 1
        : capacity;
    const visible = rows.slice(start, start + visibleCount);

    const contourPoses = spineContourPoses({
      hub,
      camera,
      viewport,
      startS: geometry.startS,
      lineCount: visible.length,
      lineHeight,
      maxWidth: effectiveLineWidth * z,
      capacity,
      bottomInset,
      rightInset,
      subLineOffset,
    });
    const fallbackPoses = !contourPoses.length
      ? geometricReadingLines({
          ...geometry,
          lineCount: visible.length,
          lineSpacing: lineHeight * z,
          offset: (48 + effectiveLineWidth / 2) * z,
          maxWidth: effectiveLineWidth * z,
        })
      : null;

    const visibleIndices = new Set<number>();
    const rowWidthPx = `${effectiveLineWidth}px`;
    const rowClassName = isCircle
      ? "geometric-row circular-row spine-row"
      : "geometric-row spine-row";
    let order = 0;
    for (let index = 0; index < visible.length; index++) {
      const rowIndex = start + index;
      visibleIndices.add(rowIndex);
      const item = visible[index];
      let row = nodes.get(rowIndex);
      if (!row) {
        row = this.createRowElement(
          article,
          state.root,
          item,
          rowClassName,
          true,
        );
        nodes.set(rowIndex, row);
      } else if (row.className !== rowClassName) {
        row.className = rowClassName;
      }
      const at = state.root.children[order++] ?? null;
      if (at !== row) state.root.insertBefore(row, at);

      const cPose = contourPoses[index];
      const fPose = fallbackPoses?.[index];
      const baselineAngle =
        isLine || isCircle
          ? 0
          : (cPose?.baselineAngle ?? fPose?.baselineAngle ?? 0);
      const side = cPose?.side ?? 1;
      const anchorX = cPose
        ? cPose.edgeX + side * ((effectiveLineWidth * z) / 2)
        : (fPose?.anchor.x ?? 0);
      const anchorY = cPose ? cPose.anchor.y : (fPose?.anchor.y ?? 0);
      const transform = `translate(${anchorX.toFixed(2)}px,${anchorY.toFixed(2)}px) rotate(${baselineAngle}deg) scale(${z}) translate(-50%,-50%)`;
      if (row.style.transform !== transform) row.style.transform = transform;
      if (row.style.width !== rowWidthPx) row.style.width = rowWidthPx;
      const nextAlign = side < 0 ? "right" : "left";
      if (row.style.textAlign !== nextAlign) row.style.textAlign = nextAlign;
      row.dataset.baselineAngle = String(baselineAngle);
      row.dataset.readingRow = String(rowIndex);
      row.dataset.hubSide = side < 0 ? "right" : "left";
      const isActive =
        cPose?.isAnchorRow ??
        (index === 0 || (index === 1 && visible[0]?.heading));
      if (isActive) row.dataset.activeRow = "true";
      else delete row.dataset.activeRow;
      if (blockStarts.has(rowIndex)) row.dataset.blockStart = "true";
      else delete row.dataset.blockStart;

      let rowOpacity = 1;
      if (subLineOffset > 0.5 && index === 0) {
        rowOpacity = Math.max(0.15, 1 - subLineOffset / lineHeight);
      } else if (subLineOffset > 0.5 && index === visible.length - 1 && visible.length > capacity) {
        rowOpacity = Math.max(0.15, subLineOffset / lineHeight);
      } else if (isCircle && rows.length > capacity) {
        if (start > 0 && index === 0) rowOpacity = 0.72;
        else if (start + capacity < rows.length && index === capacity - 1) rowOpacity = 0.72;
      }
      const nextOpacity = String(Math.round(rowOpacity * 1000) / 1000);
      if (row.style.opacity !== nextOpacity) row.style.opacity = nextOpacity;
    }
    for (const [rowIndex, node] of nodes) {
      if (!visibleIndices.has(rowIndex)) {
        clearIndexedRanges(state.root, node);
        node.remove();
        nodes.delete(rowIndex);
      }
    }

    if (state.root.style.fontFamily !== family) state.root.style.fontFamily = family;
    state.root.style.position = "absolute";
    state.root.style.width = `${viewport.width}px`;
    state.root.style.height = `${viewport.height}px`;
    state.root.style.clipPath =
      bottomInset > 0 ? `inset(0 0 ${bottomInset}px 0)` : "none";
    if (bottomInset > 0) {
      const cutY = Math.max(0, viewport.height - bottomInset);
      const mask = `linear-gradient(to bottom, #000 0px, #000 ${Math.max(0, cutY - 22)}px, rgba(0,0,0,0) ${cutY}px)`;
      state.root.style.maskImage = mask;
      state.root.style.webkitMaskImage = mask;
    } else {
      state.root.style.maskImage = "none";
      state.root.style.webkitMaskImage = "none";
    }
    state.rows = visible;
    state.activeSource =
      visible.find((row) => !row.heading)?.runs[0]?.start ?? 0;
    state.root.dataset.readingSource = String(state.activeSource);
    state.root.dataset.readingProgress = String(clampedOffset / lineHeight);
    state.root.dataset.readingSlots = String(circularReadingSlots(Math.max(1, rows.length)));
    state.root.dataset.readingRows = String(rows.length);

    if (selection) restoreReadingSelection(state.root, selection);
    return {
      maxFloat,
      textOffset:
        readingSource === undefined
          ? Math.min(offset, maxFloat)
          : start * lineHeight,
      // Only report readingRows for radial ring camera rotation when ring mode is active
      ...(docEl.dataset.circleReadingMode === "ring" ? { readingRows: rows.length } : {}),
    };
  }
}

function clampOffset(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
