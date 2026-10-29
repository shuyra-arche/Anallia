import type { Chapter, Hub } from "../core/types.ts";
import { isContentAction } from "../core/content-actions.ts";
import { resolveIconToken } from "../core/icons.ts";
import type { IconToken } from "../core/icons.ts";
import { Catalog } from "../content/catalog.ts";
import type {
  ContentBlock,
  ContentBlockKind,
  ContentDocument,
  ContentListItem,
  Inline,
  Presentation,
} from "../core/content.ts";
import {
  TextLayoutCache,
  estimateTextHeight,
  type TextStyle,
} from "./text-layout.ts";
import {
  captureReadingSelection,
  clearIndexedRanges,
  indexElementRange,
  indexTextRange,
  restoreReadingSelection,
  setBlockSourceRange,
  unindexRange,
  updateIndexedRange,
} from "./reading-anchor.ts";

export type ArticlePresentation = Presentation;

export interface ArticleVisuals {
  inlineIcon(token: IconToken, morph: number): SVGSVGElement;
  iconShowcase(hub: Hub): HTMLElement;
}

interface ExtendedCatalog {
  document?(
    id: string,
    presentation: Presentation,
  ): ContentDocument | null | undefined;
  expressionVersion?(
    id: string,
    presentation: Presentation,
  ): number | string | null | undefined;
}

type NormalizedInline =
  | {
      kind: "text";
      text: string;
      start: number;
      end: number;
    }
  | {
      kind: "reference";
      text: string;
      target: string;
      start: number;
      end: number;
    };

interface NormalizedItem {
  id: string;
  key?: string;
  inlines: NormalizedInline[];
  options?: NormalizedInline[][];
  start: number;
  end: number;
}

interface NormalizedBlock {
  id: string;
  kind: ContentBlockKind;
  start: number;
  end: number;
  stable: boolean;
  inlines: NormalizedInline[];
  items: NormalizedItem[];
}

interface NormalizedDocument {
  blocks: NormalizedBlock[];
  sourceLength: number;
  complete: boolean;
}

interface InlineRecord {
  kind: "text" | "reference";
  node: Text | HTMLButtonElement;
  start: number;
  end: number;
  text: string;
  target?: string;
}

interface InlineContainer {
  element: HTMLElement;
  records: InlineRecord[];
}

interface RenderedListItem {
  id: string;
  element: HTMLLIElement;
  shape: string;
  signature: string;
  inline?: InlineContainer;
  keyElement?: HTMLSpanElement;
  valueElement?: HTMLDivElement;
  options?: RenderedList;
}

interface RenderedList {
  element: HTMLUListElement;
  kind: "horizontal" | "vertical";
  items: Map<string, RenderedListItem>;
  order: string[];
  signature: string;
}

interface RenderedBlock {
  id: string;
  key: string;
  kind: ContentBlockKind;
  element: HTMLElement;
  signature: string;
  inline?: InlineContainer;
  list?: RenderedList;
}

interface ArticleShell {
  windowElement: HTMLDivElement;
  contentElement: HTMLDivElement;
  eyebrow: HTMLDivElement;
  heading: HTMLHeadingElement;
  origin?: HTMLDivElement;
  originButton?: HTMLButtonElement;
  tail: HTMLDivElement;
  searchBox?: HTMLDivElement;
  searchInput?: HTMLInputElement;
  searchStatus?: HTMLDivElement;
}

interface ArticleState extends ArticleShell {
  nodeId: string;
  presentation: Presentation;
  version: string;
  ready: boolean;
  blocks: Map<string, RenderedBlock>;
  order: string[];
  document: NormalizedDocument;
  isLong: boolean;
}

const finite = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

function normalizeInline(raw: Inline, cursor: number): NormalizedInline {
  const text = raw.text;
  const start = finite(raw.sourceStart, cursor);
  const end = Math.max(start, finite(raw.sourceEnd, start + text.length));
  if (raw.type === "reference") {
    return {
      kind: "reference",
      text,
      target: raw.target,
      start,
      end,
    };
  }
  return { kind: "text", text, start, end };
}

function normalizeInlines(
  raw: readonly Inline[] | undefined,
  cursor: number,
): NormalizedInline[] {
  const inlines: NormalizedInline[] = [];
  let offset = cursor;
  for (const value of raw ?? []) {
    const inline = normalizeInline(value, offset);
    inlines.push(inline);
    offset = Math.max(offset, inline.end);
  }
  return inlines;
}

function normalizeOptions(
  raw: readonly ContentListItem[] | undefined,
  cursor: number,
): NormalizedInline[][] | undefined {
  if (!raw) return undefined;
  return raw.map((option) =>
    normalizeInlines(option.inline, option.sourceStart ?? cursor),
  );
}

function itemValueInlines(raw: ContentListItem): NormalizedInline[] {
  const all = normalizeInlines(raw.inline, raw.sourceStart);
  if (!raw.key) return all;
  const keyEnd = raw.sourceStart + raw.key.length;
  return all.filter((inline) => inline.end > keyEnd);
}

function normalizeItem(
  raw: ContentListItem,
  index: number,
  blockId: string,
): NormalizedItem {
  const start = finite(raw.sourceStart, 0);
  const inlines = itemValueInlines(raw);
  const options = normalizeOptions(
    raw.options,
    start + (raw.key?.length ?? 0),
  );
  const end = Math.max(
    finite(raw.sourceEnd, start),
    ...inlines.map((inline) => inline.end),
    ...(options ?? []).flatMap((option) =>
      option.map((inline) => inline.end),
    ),
  );
  return {
    id: `${blockId}:item:${index}`,
    key: raw.key || undefined,
    inlines,
    options,
    start,
    end,
  };
}

function normalizeBlock(raw: ContentBlock, index: number): NormalizedBlock {
  const id = raw.id || `block:${index}:${raw.kind}`;
  const start = finite(raw.sourceStart, 0);
  const inlines = normalizeInlines(raw.inline, start);
  let items = (raw.items ?? []).map((item, itemIndex) =>
    normalizeItem(item, itemIndex, id),
  );
  if (
    (raw.kind === "horizontal-list" || raw.kind === "vertical-list") &&
    !items.length &&
    inlines.length
  ) {
    items = [
      {
        id: `${id}:item:0`,
        inlines,
        start,
        end: inlines.at(-1)?.end ?? start,
      },
    ];
  }
  const end = Math.max(
    finite(raw.sourceEnd, start),
    ...inlines.map((inline) => inline.end),
    ...items.map((item) => item.end),
  );
  return {
    id,
    kind: raw.kind,
    start,
    end,
    stable: raw.stable !== false,
    inlines,
    items,
  };
}

const normalizedBlocks = new WeakMap<ContentBlock, NormalizedBlock>();
function normalizeDocument(raw: ContentDocument): NormalizedDocument {
  const blocks = raw.blocks.map((block, index) => {
    const cached = normalizedBlocks.get(block);
    if (cached) return cached;
    const normalized = normalizeBlock(block, index);
    normalizedBlocks.set(block, normalized);
    return normalized;
  });
  const sourceLength =
    raw.source.length ||
    blocks.reduce(
      (length, block) =>
        length +
        block.inlines.reduce(
          (sum, inline) => sum + inline.text.length,
          0,
        ) +
        block.items.reduce(
          (sum, item) =>
            sum +
            (item.key?.length ?? 0) +
            item.inlines.reduce(
              (value, inline) => value + inline.text.length,
              0,
            ) +
            (item.options ?? []).reduce(
              (value, option) =>
                value +
                option.reduce(
                  (part, inline) => part + inline.text.length,
                  0,
                ),
              0,
            ),
          0,
        ),
      0,
    );
  return {
    blocks,
    sourceLength,
    complete: raw.complete !== false,
  };
}

function inlineSignature(inline: NormalizedInline) {
  return inline.kind === "reference"
    ? `r:${inline.start}:${inline.end}:${inline.target}:${inline.text}`
    : `t:${inline.start}:${inline.end}:${inline.text}`;
}

function inlinesSignature(inlines: NormalizedInline[]) {
  return inlines.map(inlineSignature).join("\u0001");
}

function itemSignature(item: NormalizedItem) {
  return [
    item.id,
    item.key ?? "",
    inlinesSignature(item.inlines),
    (item.options ?? []).map(inlinesSignature).join("\u0002"),
  ].join("\u0003");
}

function blockSignature(block: NormalizedBlock) {
  return [
    block.kind,
    block.start,
    block.end,
    block.stable ? "1" : "0",
    inlinesSignature(block.inlines),
    block.items.map(itemSignature).join("\u0004"),
  ].join("\u0005");
}

function itemOptions(item: NormalizedItem): NormalizedItem[] {
  return (item.options ?? []).map((inlines, index) => ({
    id: `${item.id}:option:${index}`,
    inlines,
    start: inlines[0]?.start ?? item.start,
    end: inlines.at(-1)?.end ?? item.start,
  }));
}

export class ArticleRenderer {
  private readonly catalog: Catalog;
  private readonly visuals: ArticleVisuals;
  private readonly layouts = new TextLayoutCache();
  private readonly states = new WeakMap<HTMLElement, ArticleState>();
  private readonly sources = new WeakMap<HTMLElement, string>();
  private readonly contentIdentities = new WeakMap<HTMLElement, object>();
  private readonly blocksByKey = new WeakMap<RenderedBlock, NormalizedBlock>();

  constructor(catalog: Catalog, visuals: ArticleVisuals) {
    this.catalog = catalog;
    this.visuals = visuals;
  }

  get fontVersion() {
    return this.layouts.fontVersion;
  }

  fillArticle(
    article: HTMLElement,
    node: Chapter,
    hub: Hub,
    presentation: ArticlePresentation,
  ) {
    this.syncArticle(article, node, hub, presentation);
  }

  syncArticle(
    article: HTMLElement,
    node: Chapter,
    hub: Hub,
    presentation: ArticlePresentation,
  ) {
    const catalog = this.catalog as Catalog & ExtendedCatalog;
    const contentIdentity = catalog.contentIdentity ?? catalog;
    let state = this.states.get(article);
    const versionHint =
      typeof catalog.expressionVersion === "function"
        ? catalog.expressionVersion(node.id, presentation)
        : undefined;
    if (
      state?.ready &&
      this.contentIdentities.get(article) === contentIdentity &&
      state.nodeId === node.id &&
      state.presentation === presentation &&
      state.windowElement.parentNode === article &&
      versionHint !== undefined &&
      versionHint !== null &&
      String(versionHint) === state.version
    )
      return;

    if (
      state?.ready &&
      this.contentIdentities.get(article) === contentIdentity &&
      state.nodeId === node.id &&
      state.presentation === presentation &&
      state.windowElement.parentNode === article &&
      typeof catalog.document !== "function"
    )
      return;

    const selection = state?.ready ? captureReadingSelection(article) : null;

    const rawDocument =
      typeof catalog.document === "function"
        ? catalog.document(node.id, presentation)
        : undefined;
    if (!rawDocument && state?.ready && state.nodeId === node.id)
      return;

    const document: NormalizedDocument = rawDocument
      ? normalizeDocument(rawDocument)
      : { blocks: [], sourceLength: 0, complete: false };
    const version = String(
      versionHint ??
        (rawDocument
          ? `document:${hashString(rawDocument.source)}`
          : "document:empty"),
    );

    const sameExpression = this.contentIdentities.get(article) === contentIdentity && state?.nodeId === node.id && state.presentation === presentation;
    const previousSource = this.sources.get(article);
    const source = rawDocument?.source ?? "";
    const continuation = Boolean(sameExpression && previousSource && source.startsWith(previousSource));
    state = this.ensureShell(article, node, presentation, state);
    this.states.set(article, state);
    this.sources.set(article, source);
    this.contentIdentities.set(article, contentIdentity);
    state.nodeId = node.id;
    state.presentation = presentation;
    state.version = version;
    state.document = document;
    if (!continuation) state.isLong = document.blocks.length > 1 || document.sourceLength > 220 || (!document.complete && source.length > 0);
    article.classList.toggle("is-long", state.isLong);
    article.dataset.presentation = presentation;
    article.dataset.nodeId = node.id;
    article.dataset.contentVersion = version;

    const eyebrow = `${hub.glyph} / ${node.name} · DEPTH ${String(hub.path.length - 1).padStart(2, "0")}`;
    const tail = `${node.name} · ${presentation === "circle" ? "RADIAL TO CENTER" : "LINEAR SPINE"}`;
    if (state.eyebrow.textContent !== eyebrow) state.eyebrow.textContent = eyebrow;
    if (state.heading.textContent !== node.title) state.heading.textContent = node.title;
    if (state.tail.textContent !== tail) state.tail.textContent = tail;

    this.syncOrigin(state, node);
    this.syncBlocks(article, state, document, hub);
    state.ready = true;

    if (selection) restoreReadingSelection(article, selection);
    return continuation && source.length > (previousSource?.length ?? 0) ? "append" as const : source !== previousSource || !sameExpression ? "replace" as const : undefined;
  }

  private originFor(node: Chapter): { target: string; label: string } | null {
    const sourceId = this.catalog.sourceChapterId?.(node.id);
    if (!sourceId || sourceId === node.id) return null;
    const source = this.catalog.get(sourceId);
    const hub = this.catalog.definitions.find(item => item.id === source.hub);
    return { target: source.id, label: `前往 ${hub?.glyph ?? source.hub} / ${source.name} 原枢阅读 ↗` };
  }

  private syncOrigin(state: ArticleState, node: Chapter): void {
    const origin = this.originFor(node);
    if (!origin) {
      state.origin?.remove();
      state.origin = undefined;
      state.originButton = undefined;
      return;
    }
    if (!state.origin || !state.originButton) {
      state.origin = state.contentElement.ownerDocument.createElement("div");
      state.origin.className = "mirror-origin";
      state.originButton = state.contentElement.ownerDocument.createElement("button");
      state.originButton.type = "button";
      state.originButton.className = "inline-ref";
      state.origin.append(state.originButton);
      state.contentElement.insertBefore(state.origin, state.heading.nextSibling);
    }
    if (state.originButton.textContent !== origin.label) state.originButton.textContent = origin.label;
    if (state.originButton.dataset.target !== origin.target) state.originButton.dataset.target = origin.target;
  }

  private ensureShell(
    article: HTMLElement,
    node: Chapter,
    presentation: ArticlePresentation,
    existing: ArticleState | undefined,
  ): ArticleState {
    if (existing?.windowElement.parentNode === article) {
      if (node.id === this.catalog.searchRoot && !existing.searchBox) {
        const { box, input, status } = this.createSearchBox();
        existing.contentElement.insertBefore(box, existing.tail);
        existing.searchBox = box;
        existing.searchInput = input;
        existing.searchStatus = status;
      }
      return existing;
    }

    clearIndexedRanges(article);
    const windowElement = document.createElement("div");
    windowElement.className = "note-window";
    const contentElement = document.createElement("div");
    contentElement.className = "note-content";
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    const heading = document.createElement("h2");
    const tail = document.createElement("div");
    tail.className = "tail";
    contentElement.append(eyebrow, heading);
    if (node.id === this.catalog.searchRoot) {
      const { box, input, status } = this.createSearchBox();
      contentElement.append(box);
      contentElement.append(tail);
      windowElement.append(contentElement);
      article.replaceChildren(windowElement);
      return {
        windowElement,
        contentElement,
        eyebrow,
        heading,
        tail,
        searchBox: box,
        searchInput: input,
        searchStatus: status,
        nodeId: node.id,
        presentation,
        version: "",
        ready: false,
        blocks: new Map(),
        order: [],
        document: { blocks: [], sourceLength: 0, complete: false },
        isLong: false,
      };
    }
    contentElement.append(tail);
    windowElement.append(contentElement);
    article.replaceChildren(windowElement);
    return {
      windowElement,
      contentElement,
      eyebrow,
      heading,
      tail,
      nodeId: node.id,
      presentation,
      version: "",
      ready: false,
      blocks: new Map(),
      order: [],
      document: { blocks: [], sourceLength: 0, complete: false },
      isLong: false,
    };
  }

  private createSearchBox() {
    const box = document.createElement("div");
    box.className = "hub-search-box";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "hub-search-input";
    input.placeholder =
      "键入关键词（如：流场、轴旋、深空、反演、列表、长文）…";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "检索章节并实时生成本枢周界标签");
    const status = document.createElement("div");
    status.className = "search-status";
    box.append(input, status);
    return { box, input, status };
  }

  private syncBlocks(
    article: HTMLElement,
    state: ArticleState,
    document: NormalizedDocument,
    hub: Hub,
  ) {
    const seen = new Map<string, number>();
    const desired: string[] = [];
    const nextBlocks = new Map<string, RenderedBlock>();
    for (const block of document.blocks) {
      const occurrence = seen.get(block.id) ?? 0;
      seen.set(block.id, occurrence + 1);
      const key = occurrence === 0 ? block.id : `${block.id}#${occurrence}`;
      const previous = state.blocks.get(key);
      const rendered = this.syncBlock(article, previous, block, key, hub);
      nextBlocks.set(key, rendered);
      desired.push(key);
    }

    for (const [key, rendered] of state.blocks) {
      if (nextBlocks.has(key)) continue;
      clearIndexedRanges(article, rendered.element);
      rendered.element.remove();
      this.blocksByKey.delete(rendered);
    }

    let cursor: ChildNode | null = state.order.map(key => state.blocks.get(key)?.element)
      .find(element => element?.parentNode === state.contentElement) ?? state.tail;
    for (const key of desired) {
      const element = nextBlocks.get(key)!.element;
      if (element === cursor) cursor = cursor.nextSibling;
      else state.contentElement.insertBefore(element, cursor ?? state.tail);
    }
    state.blocks = nextBlocks;
    state.order = desired;
  }

  private syncBlock(
    article: HTMLElement,
    existing: RenderedBlock | undefined,
    block: NormalizedBlock,
    key: string,
    hub: Hub,
  ): RenderedBlock {
    if (existing && existing.kind !== block.kind) {
      clearIndexedRanges(article, existing.element);
      existing.element.remove();
      this.blocksByKey.delete(existing);
      existing = undefined;
    }
    if (existing) {
      if (this.blocksByKey.get(existing) === block) return existing;
      setBlockSourceRange(
        existing.element,
        block.id,
        block.start,
        block.end,
      );
      const signature = blockSignature(block);
      if (existing.signature !== signature) {
        if (block.kind === "paragraph") {
          existing.inline = this.syncInlines(
            article,
            existing.element,
            existing.inline,
            block.id,
            block.inlines,
            hub.morph,
          );
        } else if (
          block.kind === "horizontal-list" ||
          block.kind === "vertical-list"
        ) {
          existing.list = this.syncList(
            article,
            existing.list,
            block,
            hub,
          );
        } else {
          existing.element.replaceChildren(
            this.visuals.iconShowcase(hub),
          );
        }
        existing.signature = signature;
      }
      this.blocksByKey.set(existing, block);
      return existing;
    }

    if (block.kind === "horizontal-list" || block.kind === "vertical-list") {
      const list = this.syncList(article, undefined, block, hub);
      setBlockSourceRange(list.element, block.id, block.start, block.end);
      const rendered: RenderedBlock = {
        id: block.id,
        key,
        kind: block.kind,
        element: list.element,
        signature: blockSignature(block),
        list,
      };
      this.blocksByKey.set(rendered, block);
      return rendered;
    }

    const element = document.createElement(
      block.kind === "paragraph" ? "p" : "div",
    ) as HTMLElement;
    setBlockSourceRange(element, block.id, block.start, block.end);
    const rendered: RenderedBlock = {
      id: block.id,
      key,
      kind: block.kind,
      element,
      signature: blockSignature(block),
    };
    if (block.kind === "paragraph")
      rendered.inline = this.syncInlines(
        article,
        element,
        undefined,
        block.id,
        block.inlines,
        hub.morph,
      );
    else element.append(this.visuals.iconShowcase(hub));
    this.blocksByKey.set(rendered, block);
    return rendered;
  }

  private syncList(
    article: HTMLElement,
    existing: RenderedList | undefined,
    block: NormalizedBlock,
    hub: Hub,
  ): RenderedList {
    const kind =
      block.kind === "vertical-list" ? "vertical" : "horizontal";
    let list = existing;
    if (!list || list.kind !== kind) {
      const element = document.createElement("ul");
      element.className = `shuyra-list is-${kind}`;
      if (block.kind === "vertical-list") {
        element.classList.remove("is-horizontal");
      }
      list = {
        element,
        kind,
        items: new Map(),
        order: [],
        signature: "",
      };
    }
    const signature = block.items.map(itemSignature).join("\u0004");
    if (list.signature === signature) return list;

    const desired: string[] = [];
    const nextItems = new Map<string, RenderedListItem>();
    for (const [index, item] of block.items.entries()) {
      const itemKey = item.id || `${block.id}:item:${index}`;
      const previous = list.items.get(itemKey);
      const rendered = this.syncListItem(
        article,
        previous,
        item,
        block,
        hub,
        kind,
      );
      desired.push(itemKey);
      nextItems.set(itemKey, rendered);
    }
    for (const [key, item] of list.items)
      if (!nextItems.has(key)) {
        clearIndexedRanges(article, item.element);
        item.element.remove();
      }
    let cursor = list.element.firstChild;
    for (const key of desired) {
      const element = nextItems.get(key)!.element;
      if (element === cursor) cursor = cursor.nextSibling;
      else list.element.insertBefore(element, cursor);
    }
    list.items = nextItems;
    list.order = desired;
    list.signature = signature;
    return list;
  }

  private syncListItem(
    article: HTMLElement,
    existing: RenderedListItem | undefined,
    item: NormalizedItem,
    block: NormalizedBlock,
    hub: Hub,
    kind: "horizontal" | "vertical",
  ): RenderedListItem {
    const hasKey = item.key !== undefined;
    const shape =
      kind === "horizontal" || !hasKey
        ? "inline"
        : item.options
          ? "key-options"
          : "key-prose";
    const signature = itemSignature(item);
    let rendered = existing;
    if (!rendered || rendered.shape !== shape) {
      if (rendered) clearIndexedRanges(article, rendered.element);
      const element = document.createElement("li");
      element.dataset.itemId = item.id;
      rendered = {
        id: item.id,
        element,
        shape,
        signature: "",
        inline: undefined,
        keyElement: undefined,
        valueElement: undefined,
        options: undefined,
      };
      if (shape === "inline") {
        element.className =
          kind === "vertical"
            ? "shuyra-list-item is-plain-item"
            : "shuyra-list-item";
        rendered.inline = this.syncInlines(
          article,
          element,
          undefined,
          block.id,
          item.inlines,
          hub.morph,
        );
      } else {
        element.className = "shuyra-list-item";
        const keyElement = document.createElement("span");
        keyElement.className = "list-key";
        const valueElement = document.createElement("div");
        valueElement.className = `list-val is-${
          shape === "key-options" ? "options" : "prose"
        }`;
        element.append(keyElement, valueElement);
        rendered.keyElement = keyElement;
        rendered.valueElement = valueElement;
        if (shape === "key-options")
          rendered.options = this.syncList(
            article,
            undefined,
            {
              ...block,
              kind: "horizontal-list",
              items: itemOptions(item),
              inlines: [],
            },
            hub,
          );
        else
          rendered.inline = this.syncInlines(
            article,
            valueElement,
            undefined,
            block.id,
            item.inlines,
            hub.morph,
          );
      }
    } else if (signature !== rendered.signature) {
      if (rendered.shape === "inline" && rendered.inline) {
        rendered.inline = this.syncInlines(
          article,
          rendered.element,
          rendered.inline,
          block.id,
          item.inlines,
          hub.morph,
        );
      } else if (rendered.keyElement && rendered.valueElement) {
        rendered.keyElement.textContent = item.key ?? "";
        indexElementRange(
          article,
          rendered.keyElement,
          item.start,
          item.start + (item.key?.length ?? 0),
          block.id,
        );
        if (rendered.options)
          rendered.options = this.syncList(
            article,
            rendered.options,
            {
              ...block,
              kind: "horizontal-list",
              items: itemOptions(item),
              inlines: [],
            },
            hub,
          );
        else if (rendered.inline)
          rendered.inline = this.syncInlines(
            article,
            rendered.valueElement!,
            rendered.inline,
            block.id,
            item.inlines,
            hub.morph,
          );
      }
    }
    if (rendered.keyElement) {
      const keyText = item.key ?? "";
      if (rendered.keyElement.textContent !== keyText)
        rendered.keyElement.textContent = keyText;
    }
    if (
      rendered.options &&
      rendered.valueElement &&
      rendered.options.element.parentNode !== rendered.valueElement
    )
      rendered.valueElement.append(rendered.options.element);
    if (rendered.keyElement && kind === "vertical")
      indexElementRange(
        article,
        rendered.keyElement,
        item.start,
        item.start + (item.key?.length ?? 0),
        block.id,
      );
    rendered.signature = signature;
    return rendered;
  }

  private syncInlines(
    article: HTMLElement,
    container: HTMLElement,
    existing: InlineContainer | undefined,
    blockId: string,
    inlines: NormalizedInline[],
    hubMorph = 0,
  ): InlineContainer {
    inlines = inlines.map(inline => inline.kind === "reference" && !isContentAction(inline.target) && !this.catalog.chapters.has(inline.target)
      ? { kind: "text" as const, text: `{${inline.text}|${inline.target}}`, start: inline.start, end: inline.end }
      : inline);
    const state: InlineContainer = existing ?? { element: container, records: [] };
    let prefix = 0;
    while (
      prefix < state.records.length &&
      prefix < inlines.length &&
      inlineSignature(inlines[prefix]) ===
        this.recordSignature(state.records[prefix])
    )
      prefix++;

    let cursor = prefix;
    while (
      cursor < state.records.length &&
      cursor < inlines.length &&
      state.records[cursor].kind === "text" &&
      inlines[cursor].kind === "text" &&
      state.records[cursor].start === inlines[cursor].start
    ) {
      const record = state.records[cursor];
      const inline = inlines[cursor] as Extract<NormalizedInline, { kind: "text" }>;
      const node = record.node;
      if (node.nodeType !== 3) break;
      const textNode = node as Text;
      if (inline.text.startsWith(record.text))
        textNode.appendData(inline.text.slice(record.text.length));
      else textNode.data = inline.text;
      record.text = inline.text;
      record.end = inline.end;
      updateIndexedRange(article, textNode, inline.start, inline.end);
      cursor++;
    }

    for (let index = state.records.length - 1; index >= cursor; index--) {
      const record = state.records[index];
      unindexRange(article, record.node);
      record.node.remove();
    }
    state.records.length = cursor;

    for (let index = cursor; index < inlines.length; index++) {
      const inline = inlines[index];
      if (inline.kind === "text") {
        if (!inline.text) continue;
        const node = article.ownerDocument.createTextNode(inline.text);
        container.append(node);
        indexTextRange(article, node, inline.start, inline.end, blockId);
        state.records.push({
          kind: "text",
          node,
          start: inline.start,
          end: inline.end,
          text: inline.text,
        });
      } else {
        const button = this.createReference(inline, hubMorph);
        container.append(button);
        indexElementRange(
          article,
          button,
          inline.start,
          inline.end,
          blockId,
        );
        state.records.push({
          kind: "reference",
          node: button,
          start: inline.start,
          end: inline.end,
          text: inline.text,
          target: inline.target,
        });
      }
    }
    return state;
  }

  private recordSignature(record: InlineRecord) {
    return record.kind === "reference"
      ? `r:${record.start}:${record.end}:${record.target}:${record.text}`
      : `t:${record.start}:${record.end}:${record.text}`;
  }

  private createReference(
    inline: Extract<NormalizedInline, { kind: "reference" }>,
    hubMorph: number,
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inline-ref";
    button.dataset.target = inline.target;
    button.dataset.sourceStart = String(inline.start);
    button.dataset.sourceEnd = String(inline.end);
    const rawLabel = inline.text.trim();
    const firstChar = Array.from(rawLabel)[0] ?? "";
    const iconToken = resolveIconToken(firstChar);
    const suffix = inline.target.startsWith("act:") ? "" : " ↗";
    if (iconToken) {
      button.classList.add("has-inline-icon");
      button.append(this.visuals.inlineIcon(iconToken, hubMorph));
      const rest = rawLabel.slice(firstChar.length).trim();
      button.append(
        articleTextNode(
          button,
          rest ? ` ${rest}${suffix}` : `${firstChar}${suffix}`,
        ),
      );
    } else {
      button.textContent = inline.target.startsWith("act:")
        ? rawLabel || inline.target
        : `${rawLabel || inline.target}${suffix}`;
    }
    return button;
  }

  releaseArticle(article: HTMLElement) {
    const state = this.states.get(article);
    if (state) this.layouts.evict(`${state.nodeId}:`);
    this.states.delete(article);
    this.sources.delete(article);
    this.contentIdentities.delete(article);
    clearIndexedRanges(article);
  }

  invalidateFonts(version?: string) {
    this.layouts.invalidateFont(version);
  }

  estimateArticleHeight(
    article: HTMLElement,
    node: Chapter,
    presentation: ArticlePresentation,
    width: number,
    measureUnstable?: (blockId: string) => number,
  ): number {
    const catalog = this.catalog as Catalog & ExtendedCatalog;
    let state = this.states.get(article);
    let document: NormalizedDocument;
    if (
      state?.nodeId === node.id &&
      state.presentation === presentation &&
      state.document.blocks.length
    ) {
      document = state.document;
    } else {
      const raw = catalog.document?.(node.id, presentation);
      document = raw
        ? normalizeDocument(raw)
        : { blocks: [], sourceLength: 0, complete: false };
      state = undefined;
    }
    const isLong =
      document.blocks.length > 1 || document.sourceLength > 220;
    const style = this.resolveStyle(article, isLong);
    let height = 25 + estimateTextHeight(node.title, width, {
      ...style,
      font: `620 23.5px ${fontFamilyOf(style.font)}`,
      lineHeight: 31,
    }) + 11;
    if (state?.searchBox) height += 76;
    const origin = this.originFor(node);
    if (origin) height += this.layouts.layout(`${node.id}:origin`, origin.label, width, {
      ...style, font: `640 13.8px ${fontFamilyOf(style.font)}`, lineHeight: 25.392, letterSpacing: .1104,
    }, { contentVersion: origin.label, stable: true }).height + 16;
    height += 18;
    for (const block of document.blocks) {
      if (block.kind === "icons") {
        height += 190;
        continue;
      }
      if (block.kind === "paragraph") {
        const text = inlineText(block.inlines);
        const rendered = state
          ? this.findRenderedBlock(state, block)
          : undefined;
        const measuredHeight = rendered?.element.offsetHeight ?? (!block.stable ? measureUnstable?.(block.id) : 0) ?? 0;
        const domHeight =
          !block.stable && measuredHeight > 0 ? measuredHeight : undefined;
        height +=
          this.layouts.layout(
            `${node.id}:${presentation}:${block.id}`,
            text,
            width,
            style,
            {
              contentVersion: `${block.start}:${inlinesSignature(block.inlines)}`,
              stable: block.stable,
              domHeight,
            },
          ).height + 11;
        continue;
      }
      height += 12;
      for (const item of block.items) {
        const itemStyle =
          block.kind === "vertical-list"
            ? { ...style, font: `13px ${fontFamilyOf(style.font)}`, lineHeight: 20 }
            : style;
        const keyHeight = item.key
          ? estimateTextHeight(item.key, width, itemStyle)
          : 0;
        const proseHeight = item.inlines.length
          ? estimateTextHeight(inlineText(item.inlines), width, itemStyle)
          : 0;
        const optionsHeight = (item.options ?? []).length
          ? Math.max(
              ...(item.options ?? []).map((option) =>
                estimateTextHeight(inlineText(option), width, itemStyle),
              ),
            )
          : 0;
        height += Math.max(keyHeight, proseHeight, optionsHeight) + 12;
      }
    }
    return Math.max(0, Math.round(height));
  }

  private findRenderedBlock(state: ArticleState, block: NormalizedBlock) {
    const direct = state.blocks.get(block.id);
    if (direct && this.blocksByKey.get(direct)?.start === block.start) return direct;
    for (const key of state.order) {
      const rendered = state.blocks.get(key);
      if (
        rendered?.id === block.id &&
        this.blocksByKey.get(rendered)?.start === block.start
      )
        return rendered;
    }
    return undefined;
  }

  private resolveStyle(article: HTMLElement, isLong: boolean): TextStyle {
    const probe =
      article.querySelector<HTMLElement>(
        "p, .shuyra-list .list-val, .shuyra-list-item",
      ) ?? article;
    const view = article.ownerDocument.defaultView;
    const computed = view?.getComputedStyle(probe);
    const family = computed?.fontFamily?.trim() || "serif";
    const size = isLong ? 13.4 : 13.8;
    const font = computed?.font?.trim() || `${size}px ${family}`;
    const lineHeight =
      Number.parseFloat(computed?.lineHeight ?? "") || (isLong ? 24.4 : 25.4);
    const letterSpacing =
      Number.parseFloat(computed?.letterSpacing ?? "") || 0;
    return { font, lineHeight, letterSpacing };
  }
}

function inlineText(inlines: NormalizedInline[]) {
  return inlines
    .map((inline) =>
      inline.kind === "reference" ? inline.text : inline.text,
    )
    .join("");
}

function fontFamilyOf(font: string) {
  const match = /\d+(?:\.\d+)?px\s+(.+)$/.exec(font);
  return match?.[1] ?? "serif";
}

function articleTextNode(owner: Node, text: string) {
  return owner.ownerDocument!.createTextNode(text);
}
