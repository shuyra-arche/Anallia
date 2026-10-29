import type {
  ContentBlock,
  ContentBlockKind,
  ContentDocument,
  ContentListItem,
  Inline,
  ReferenceInline,
  TextInline,
} from "../core/content.ts";

const REFERENCE = /\{([^{}|]+)\|([^{}]+)\}/g;
const LIST_ITEM_SEPARATOR = " | ";

function isWhitespace(code: number) {
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 13 ||
    code === 12 ||
    code === 11 ||
    code === 0xa0
  );
}

function trimRange(source: string, start: number, end: number) {
  while (start < end && isWhitespace(source.charCodeAt(start))) start++;
  while (end > start && isWhitespace(source.charCodeAt(end - 1))) end--;
  return { start, end };
}

function textInline(source: string, start: number, end: number): TextInline {
  return {
    type: "text",
    text: source.slice(start, end),
    sourceStart: start,
    sourceEnd: end,
  };
}

function parseInline(
  source: string,
  start: number,
  end: number,
  blockId: string,
): Inline[] {
  const inline: Inline[] = [];
  let cursor = start;
  REFERENCE.lastIndex = 0;
  for (const match of source.slice(start, end).matchAll(REFERENCE)) {
    const matchStart = start + match.index!;
    if (matchStart > cursor)
      inline.push(textInline(source, cursor, matchStart));
    inline.push({
      type: "reference",
      text: match[1],
      target: match[2],
      sourceStart: matchStart,
      sourceEnd: matchStart + match[0].length,
      blockId,
    });
    cursor = matchStart + match[0].length;
  }
  if (cursor < end) inline.push(textInline(source, cursor, end));
  return inline;
}

function splitRanges(
  source: string,
  start: number,
  end: number,
  delimiter: string,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const index = source.indexOf(delimiter, cursor);
    if (index === -1 || index >= end) {
      ranges.push(trimRange(source, cursor, end));
      break;
    }
    ranges.push(trimRange(source, cursor, index));
    cursor = index + delimiter.length;
  }
  return ranges;
}

function splitLines(
  source: string,
  start: number,
  end: number,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let cursor = start;
  while (cursor < end) {
    const newline = source.indexOf("\n", cursor);
    const lineEnd = newline === -1 || newline > end ? end : newline;
    if (lineEnd > cursor)
      ranges.push(trimRange(source, cursor, lineEnd));
    if (lineEnd >= end) break;
    cursor = lineEnd + 1;
  }
  return ranges;
}

function listItem(
  start: number,
  end: number,
  inline: Inline[],
): ContentListItem {
  return { sourceStart: start, sourceEnd: end, inline };
}

function parseHorizontalItems(
  source: string,
  start: number,
  end: number,
  blockId: string,
): ContentListItem[] {
  const separator = source.indexOf(LIST_ITEM_SEPARATOR, start);
  const ranges =
    separator !== -1 && separator < end
      ? splitRanges(source, start, end, LIST_ITEM_SEPARATOR)
      : splitLines(source, start, end);
  return ranges
    .filter((range) => range.start < range.end)
    .map((range) =>
      listItem(
        range.start,
        range.end,
        parseInline(source, range.start, range.end, blockId),
      ),
    );
}

function parseVerticalItems(
  source: string,
  start: number,
  end: number,
  blockId: string,
): ContentListItem[] {
  const lines = splitLines(source, start, end);
  const items: ContentListItem[] = [];
  for (const line of lines) {
    if (line.start >= line.end) continue;
    const separator = source.indexOf("::", line.start);
    if (separator === -1 || separator >= line.end) {
      items.push(
        listItem(
          line.start,
          line.end,
          parseInline(source, line.start, line.end, blockId),
        ),
      );
      continue;
    }
    const keyRange = trimRange(source, line.start, separator);
    const valueRange = trimRange(source, separator + 2, line.end);
    const key = source.slice(keyRange.start, keyRange.end);
    const value = source.slice(valueRange.start, valueRange.end);
    const inline: Inline[] = [
      ...parseInline(source, keyRange.start, keyRange.end, blockId),
    ];
    const options: ContentListItem[] = [];
    if (value.includes(LIST_ITEM_SEPARATOR)) {
      // The separator is ASCII, so the trimmed value's utf-16 index is enough.
      for (const option of splitRanges(
        source,
        valueRange.start,
        valueRange.end,
        LIST_ITEM_SEPARATOR,
      )) {
        if (option.start >= option.end) continue;
        options.push(
          listItem(
            option.start,
            option.end,
            parseInline(source, option.start, option.end, blockId),
          ),
        );
      }
      for (const option of options) inline.push(...option.inline);
    } else {
      inline.push(...parseInline(source, valueRange.start, valueRange.end, blockId));
    }
    items.push({
      sourceStart: line.start,
      sourceEnd: line.end,
      inline,
      key,
      value,
      ...(options.length ? { options } : {}),
    });
  }
  return items;
}

function hasOpenReference(text: string) {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) return false;
    const close = text.indexOf("}", open + 1);
    if (close === -1) return true;
    cursor = close + 1;
  }
  return false;
}

function blockKind(text: string): ContentBlockKind {
  if (/^\[icons\]\s*$/.test(text)) return "icons";
  if (text.startsWith("[hlist]")) return "horizontal-list";
  if (text.startsWith("[vlist]")) return "vertical-list";
  return "paragraph";
}

function markerEnd(
  source: string,
  start: number,
  end: number,
  marker: string,
) {
  let cursor = start + marker.length;
  while (cursor < end && isWhitespace(source.charCodeAt(cursor))) cursor++;
  return cursor;
}

function attachAliases(
  block: ContentBlock,
  source: string,
  items: ContentListItem[] | undefined,
) {
  Object.defineProperties(block, {
    items: { value: items, enumerable: false, configurable: true },
    text: {
      value: source.slice(block.sourceStart, block.sourceEnd),
      enumerable: false,
      configurable: true,
    },
    inlines: { value: block.inline, enumerable: false, configurable: true },
    children: { value: block.inline, enumerable: false, configurable: true },
  });
}

function createBlock(
  source: string,
  kind: ContentBlockKind,
  start: number,
  end: number,
  stable: boolean,
): { block: ContentBlock; items?: ContentListItem[] } {
  const id = `${kind}:${start}`;
  let inline: Inline[] = [];
  let items: ContentListItem[] | undefined;
  if (kind === "horizontal-list") {
    items = parseHorizontalItems(
      source,
      markerEnd(source, start, end, "[hlist]"),
      end,
      id,
    );
    inline = items.flatMap((item) => item.inline);
  } else if (kind === "vertical-list") {
    items = parseVerticalItems(
      source,
      markerEnd(source, start, end, "[vlist]"),
      end,
      id,
    );
    inline = items.flatMap((item) => item.inline);
  } else if (kind === "paragraph") {
    inline = parseInline(source, start, end, id);
  }
  const block: ContentBlock = {
    id,
    kind,
    sourceStart: start,
    sourceEnd: end,
    stable,
    inline,
  };
  attachAliases(block, source, items);
  return { block, items };
}

/**
 * Parse the author syntax. When `complete` is false the trailing, still-growing
 * block is marked unstable; an unterminated `{label|target` stays literal text
 * until a later call sees both its closing brace and a valid body.
 */
export function parseContent(
  source: string,
  complete = true,
  from = 0,
): ContentDocument {
  const candidates: {
    start: number;
    end: number;
    rawEnd: number;
    isTail: boolean;
  }[] = [];
  let cursor = from;
  const separator = /\n{2,}/g;
  for (const match of source.slice(from).matchAll(separator)) {
    const rawEnd = from + match.index!;
    const range = trimRange(source, cursor, rawEnd);
    candidates.push({ ...range, rawEnd, isTail: false });
    cursor = rawEnd + match[0].length;
  }
  const tailRange = trimRange(source, cursor, source.length);
  candidates.push({
    ...tailRange,
    rawEnd: source.length,
    isTail: true,
  });

  const blocks: ContentBlock[] = [];
  const references: ReferenceInline[] = [];
  for (const candidate of candidates) {
    if (candidate.start >= candidate.end) continue;
    const text = source.slice(candidate.start, candidate.end);
    const kind = blockKind(text);
    const openReference = hasOpenReference(text);
    const growing =
      !complete && candidate.isTail && candidate.rawEnd === source.length;
    const stable = complete ? true : !growing && !openReference;
    const { block } = createBlock(
      source,
      kind,
      candidate.start,
      candidate.end,
      stable,
    );
    blocks.push(block);
    for (const item of block.inline)
      if (item.type === "reference") references.push(item);
  }

  const document: ContentDocument = { blocks, references } as ContentDocument;
  Object.defineProperties(document, {
    source: { value: source, enumerable: false },
    complete: { value: complete, enumerable: false },
  });
  return document;
}

/** Preserve stable blocks and reparse only the growing suffix on append. */
export function updateContent(previous: ContentDocument, source: string, complete = true): ContentDocument {
  if (!source.startsWith(previous.source) || previous.blocks.length < 2)
    return parseContent(source, complete);
  let count = 0;
  while (count < previous.blocks.length - 1 && previous.blocks[count].stable) count++;
  if (!count) return parseContent(source, complete);
  const prefix = previous.blocks.slice(0, count);
  const tailStart = previous.blocks[count].sourceStart;
  const suffix = parseContent(source, complete, tailStart);
  const blocks = [...prefix, ...suffix.blocks];
  const references = [...previous.references.filter(reference => reference.sourceEnd <= tailStart), ...suffix.references];
  const document = { blocks, references } as ContentDocument;
  Object.defineProperties(document, { source: { value: source }, complete: { value: complete } });
  return document;
}

/** Visible text, with references rendered as their labels and blocks separated. */
export function contentText(document: ContentDocument): string {
  return document.blocks
    .map((block) =>
      block.inline
        .map((inline) =>
          inline.type === "reference" ? inline.text : inline.text,
        )
        .join(""),
    )
    .join("\n\n");
}

export const toPlainText = contentText;
