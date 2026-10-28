export interface SourceRange {
  start: number;
  end: number;
}

interface IndexedRange extends SourceRange {
  node: Node;
  blockId: string | null;
  kind: "text" | "element";
}

interface RangeIndex {
  byNode: Map<Node, IndexedRange>;
}

const indexes = new WeakMap<HTMLElement, RangeIndex>();

const indexFor = (root: HTMLElement) => {
  let index = indexes.get(root);
  if (!index) {
    index = { byNode: new Map() };
    indexes.set(root, index);
  }
  return index;
};

const finite = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;

function addRange(
  root: HTMLElement,
  node: Node,
  start: number,
  end: number,
  blockId: string | null,
  kind: "text" | "element",
) {
  const safeStart = finite(start, 0);
  const safeEnd = Math.max(safeStart, finite(end, safeStart));
  indexFor(root).byNode.set(node, {
    node,
    start: safeStart,
    end: safeEnd,
    blockId,
    kind,
  });
}

export function indexTextRange(
  root: HTMLElement,
  node: Text,
  start: number,
  end: number,
  blockId?: string | null,
) {
  addRange(root, node, start, end, blockId ?? null, "text");
}

export function indexElementRange(
  root: HTMLElement,
  element: Element,
  start: number,
  end: number,
  blockId?: string | null,
) {
  addRange(root, element, start, end, blockId ?? null, "element");
}

export function updateIndexedRange(
  root: HTMLElement,
  node: Node,
  start: number,
  end: number,
) {
  const entry = indexes.get(root)?.byNode.get(node);
  if (!entry) return;
  entry.start = finite(start, entry.start);
  entry.end = Math.max(entry.start, finite(end, entry.end));
}

export function unindexRange(root: HTMLElement, node: Node) {
  indexes.get(root)?.byNode.delete(node);
}

export function clearIndexedRanges(root: HTMLElement, scope?: Node) {
  const index = indexes.get(root);
  if (!index) return;
  if (!scope || scope === root) {
    index.byNode.clear();
    return;
  }
  for (const node of index.byNode.keys()) {
    const withinScope =
      node === scope ||
      (scope.nodeType === 1 && (scope as Element).contains(node));
    if (withinScope || !root.contains(node)) index.byNode.delete(node);
  }
}

export function setBlockSourceRange(
  element: HTMLElement,
  blockId: string,
  start: number,
  end: number,
) {
  element.dataset.blockId = blockId;
  element.dataset.sourceStart = String(finite(start, 0));
  element.dataset.sourceEnd = String(Math.max(start, finite(end, start)));
}

function closestBlock(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof Element)
      return current.closest<HTMLElement>("[data-block-id]");
    current = current.parentNode;
  }
  return root.querySelector<HTMLElement>("[data-block-id]");
}

function blockIdOf(block: HTMLElement | null): string | null {
  return block?.dataset.blockId ?? null;
}

function blockBounds(block: HTMLElement): SourceRange {
  return {
    start: finite(Number(block.dataset.sourceStart), 0),
    end: finite(Number(block.dataset.sourceEnd), 0),
  };
}

function blockElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"));
}

function blockAtSource(
  root: HTMLElement,
  source: number,
  preferredBlockId?: string | null,
): { block: HTMLElement; start: number; end: number; clamped: boolean } | null {
  const blocks = blockElements(root);
  if (!blocks.length) return null;
  const preferred = preferredBlockId
    ? blocks.find((block) => block.dataset.blockId === preferredBlockId)
    : undefined;
  let block = preferred;
  if (!block) {
    block =
      blocks.find((candidate) => {
        const bounds = blockBounds(candidate);
        return source >= bounds.start && source <= bounds.end;
      }) ??
      blocks
        .slice()
        .sort(
          (a, b) =>
            Math.abs(blockBounds(a).start - source) -
            Math.abs(blockBounds(b).start - source),
        )[0];
  }
  const bounds = blockBounds(block);
  const clampedSource =
    preferred && (source < bounds.start || source > bounds.end)
      ? Math.min(bounds.end, Math.max(bounds.start, source))
      : source;
  return {
    block,
    start: bounds.start,
    end: bounds.end,
    clamped: clampedSource !== source,
  };
}

export interface SourceRangeLocation {
  range: Range;
  blockId: string | null;
  block: HTMLElement | null;
  source: number;
  start: number;
  end: number;
  clamped: boolean;
}

export function rangeAtSource(
  root: HTMLElement,
  source: number,
  preferredBlockId?: string | null,
): SourceRangeLocation | null {
  const document = root.ownerDocument;
  const index = indexes.get(root);
  const located = blockAtSource(root, source, preferredBlockId);
  if (!located) {
    if (!index) return null;
    const fallback = Array.from(index.byNode.values()).sort(
      (a, b) =>
        Math.abs(a.start - source) - Math.abs(b.start - source),
    )[0];
    if (!fallback) return null;
    const range = document.createRange();
    if (fallback.kind === "text") {
      const offset = Math.min(
        fallback.end - fallback.start,
        Math.max(0, source - fallback.start),
      );
      range.setStart(fallback.node, offset);
      range.collapse(true);
    } else {
      range.selectNodeContents(fallback.node);
      range.collapse(true);
    }
    return {
      range,
      blockId: fallback.blockId,
      block: null,
      source: fallback.start,
      start: fallback.start,
      end: fallback.end,
      clamped: true,
    };
  }

  const range = document.createRange();
  const clampedSource = Math.min(
    located.end,
    Math.max(located.start, source),
  );
  const entries =
    index && located.block
      ? Array.from(index.byNode.values()).filter(
          (entry) =>
            root.contains(entry.node) &&
            (entry.blockId === blockIdOf(located.block) ||
              located.block!.contains(entry.node)),
        )
      : [];
  const hits = entries.filter(
    (entry) =>
      clampedSource >= entry.start && clampedSource <= entry.end,
  );
  const entry =
    hits.find((candidate) => candidate.kind === "text") ??
    hits.sort((a, b) => b.start - a.start)[0];

  if (entry) {
    if (entry.kind === "text" && entry.node.nodeType === 3) {
      const offset = Math.min(
        entry.end - entry.start,
        Math.max(0, clampedSource - entry.start),
      );
      range.setStart(entry.node, offset);
      range.collapse(true);
    } else {
      range.selectNodeContents(entry.node);
      range.collapse(true);
    }
    return {
      range,
      blockId: blockIdOf(located.block),
      block: located.block,
      source: clampedSource,
      start: located.start,
      end: located.end,
      clamped: located.clamped || clampedSource !== source,
    };
  }

  const nearest = entries.sort(
    (a, b) =>
      Math.abs(a.start - clampedSource) - Math.abs(b.start - clampedSource),
  )[0];
  if (nearest) {
    if (nearest.kind === "text" && nearest.node.nodeType === 3) {
      const offset = Math.min(
        nearest.end - nearest.start,
        Math.max(0, clampedSource - nearest.start),
      );
      range.setStart(nearest.node, offset);
    } else {
      range.selectNodeContents(nearest.node);
      range.collapse(true);
    }
  } else if (located.block) {
    range.selectNodeContents(located.block);
    range.collapse(true);
  } else {
    return null;
  }
  return {
    range,
    blockId: blockIdOf(located.block),
    block: located.block,
    source: clampedSource,
    start: located.start,
    end: located.end,
    clamped: located.clamped || clampedSource !== source,
  };
}

function pointSource(node: Node, offset: number, root: HTMLElement): number | null {
  const index = indexes.get(root);
  let current: Node | null = node;
  let currentOffset = offset;
  while (current && current !== root) {
    if (current.nodeType === 3) {
      const entry = index?.byNode.get(current);
      if (entry) return entry.start + Math.min(currentOffset, current.textContent?.length ?? 0);
    } else {
      const entry = index?.byNode.get(current);
      if (entry) return entry.start;
    }
    currentOffset = 0;
    current = current.parentNode;
  }
  const block = closestBlock(node, root);
  if (!block) return null;
  const bounds = blockBounds(block);
  if (node.nodeType === 3) {
    const blockOffset = block.textContent
      ? Math.max(0, block.textContent.indexOf(node.textContent ?? ""))
      : 0;
    return Math.min(bounds.end, bounds.start + blockOffset + currentOffset);
  }
  return bounds.start;
}

export interface ReadingSelection {
  anchorSource: number;
  focusSource: number;
  collapsed: boolean;
}

export function captureReadingSelection(
  root: HTMLElement,
): ReadingSelection | null {
  const document = root.ownerDocument;
  const selection = document.getSelection?.();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const anchorNode = selection.anchorNode ?? range.startContainer;
  const anchorOffset = selection.anchorOffset ?? range.startOffset;
  const focusNode = selection.focusNode ?? range.endContainer;
  const focusOffset = selection.focusOffset ?? range.endOffset;
  const anchorSource = pointSource(anchorNode, anchorOffset, root);
  const focusSource = pointSource(focusNode, focusOffset, root);
  if (anchorSource === null || focusSource === null) return null;
  return {
    anchorSource,
    focusSource,
    collapsed: anchorSource === focusSource,
  };
}

export function restoreReadingSelection(
  root: HTMLElement,
  selection: ReadingSelection,
): boolean {
  const document = root.ownerDocument;
  const browserSelection = document.getSelection?.();
  if (!browserSelection) return false;
  const start = rangeAtSource(
    root,
    Math.min(selection.anchorSource, selection.focusSource),
  );
  const end = rangeAtSource(
    root,
    Math.max(selection.anchorSource, selection.focusSource),
  );
  if (!start || !end) return false;
  const range = document.createRange();
  range.setStart(start.range.startContainer, start.range.startOffset);
  range.setEnd(end.range.endContainer, end.range.endOffset);
  browserSelection.removeAllRanges();
  browserSelection.addRange(range);
  if (
    typeof browserSelection.setBaseAndExtent === "function" &&
    !selection.collapsed
  ) {
    browserSelection.setBaseAndExtent(
      range.startContainer,
      range.startOffset,
      range.endContainer,
      range.endOffset,
    );
  }
  return true;
}

export interface ReadingAnchor {
  article: HTMLElement;
  blockId: string | null;
  source: number;
  start: number;
  end: number;
  top: number;
  scroller: HTMLElement | null;
  scrollTop: number;
}

export interface CaptureReadingAnchorOptions {
  source?: number;
  scroller?: HTMLElement | null;
  selection?: boolean;
}

export function captureReadingAnchor(
  root: HTMLElement,
  options: CaptureReadingAnchorOptions = {},
): ReadingAnchor | null {
  let source = options.source;
  let preferredBlockId: string | null = null;
  if (source === undefined && options.selection !== false) {
    const selection = captureReadingSelection(root);
    if (selection) {
      source = selection.anchorSource;
      const block = closestBlock(
        root.ownerDocument.getSelection?.()?.anchorNode ?? root,
        root,
      );
      preferredBlockId = blockIdOf(block);
    }
  }
  if (source === undefined) {
    const index = indexes.get(root);
    const first =
      index &&
      Array.from(index.byNode.values())
        .filter((entry) => root.contains(entry.node))
        .sort((a, b) => a.start - b.start)[0];
    if (first) {
      source = first.start;
      preferredBlockId = first.blockId;
    } else {
      const block = blockElements(root)[0];
      if (block) {
        source = blockBounds(block).start;
        preferredBlockId = blockIdOf(block);
      }
    }
  }
  if (source === undefined) return null;
  const located = rangeAtSource(root, source, preferredBlockId);
  if (!located) return null;
  const scroller =
    options.scroller === undefined
      ? root.querySelector<HTMLElement>(".note-window")
      : options.scroller;
  const rect = located.range.getBoundingClientRect();
  return {
    article: root,
    blockId: located.blockId,
    source: located.source,
    start: located.start,
    end: located.end,
    top: rect.top,
    scroller,
    scrollTop: scroller?.scrollTop ?? 0,
  };
}

export interface RestoreReadingAnchorOptions {
  scroller?: HTMLElement | null;
  tolerance?: number;
  apply?: boolean;
}

export interface RestoreReadingAnchorResult {
  source: number;
  blockId: string | null;
  top: number;
  delta: number;
  adjusted: boolean;
  clamped: boolean;
  range: Range | null;
}

export function restoreReadingAnchor(
  root: HTMLElement,
  anchor: ReadingAnchor,
  options: RestoreReadingAnchorOptions = {},
): RestoreReadingAnchorResult {
  const located = rangeAtSource(root, anchor.source, anchor.blockId);
  if (!located) {
    return {
      source: anchor.source,
      blockId: null,
      top: anchor.top,
      delta: 0,
      adjusted: false,
      clamped: true,
      range: null,
    };
  }
  const rect = located.range.getBoundingClientRect();
  const delta = rect.top - anchor.top;
  const scroller = options.scroller ?? anchor.scroller;
  const tolerance = options.tolerance ?? 2;
  const adjust = options.apply !== false;
  let adjusted = false;
  if (adjust && scroller && Math.abs(delta) > tolerance) {
    const before = scroller.scrollTop;
    scroller.scrollTop = before + delta;
    adjusted = scroller.scrollTop !== before;
  }
  return {
    source: located.source,
    blockId: located.blockId,
    top: rect.top,
    delta,
    adjusted,
    clamped: located.clamped,
    range: located.range,
  };
}
