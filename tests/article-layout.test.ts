import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { Chapter, Hub } from "../src/core/types.ts";
import type { Catalog } from "../src/content/catalog.ts";
import { ArticleRenderer } from "../src/rendering/article.ts";
import {
  TextLayoutCache,
  estimateTextHeight,
} from "../src/rendering/text-layout.ts";

type FixtureInline =
  | {
      type: "text";
      text: string;
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      type: "reference";
      text: string;
      target: string;
      sourceStart: number;
      sourceEnd: number;
    };

interface FixtureItem {
  id?: string;
  key?: string;
  inline: FixtureInline[];
  options?: FixtureItem[] | FixtureInline[][];
  sourceStart?: number;
  sourceEnd?: number;
}

interface FixtureBlock {
  id: string;
  kind: "paragraph" | "horizontal-list" | "vertical-list" | "icons";
  sourceStart: number;
  sourceEnd: number;
  stable: boolean;
  inline: FixtureInline[];
  items?: FixtureItem[];
}

interface FixtureDocument {
  source: string;
  complete: boolean;
  blocks: FixtureBlock[];
  references: unknown[];
}

interface FakeCatalog extends Catalog {
  version: number;
  setDocument(
    presentation: "circle" | "line",
    document: FixtureDocument,
  ): void;
}

function documentOf(
  blocks: FixtureBlock[],
  source = blocks
    .flatMap((block) => block.inline.map((inline) => inline.text))
    .join(""),
  complete = true,
): FixtureDocument {
  return { source, complete, blocks, references: [] };
}

function setup() {
  const window = new Window({ width: 390, height: 844 });
  const saved = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    Element: (globalThis as Record<string, unknown>).Element,
    HTMLElement: (globalThis as Record<string, unknown>).HTMLElement,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
  });
  window.document.write("<!doctype html><html><body></body></html>");
  return {
    window,
    close() {
      window.close();
      Object.assign(globalThis, saved);
    },
  };
}

function makeCatalog() {
  let circle = documentOf([]);
  let line = documentOf([]);
  const catalog = {
    searchRoot: "q0",
    chapters: new Map([["a0", {}]]),
    version: 0,
    document: (_id: string, presentation: "circle" | "line") =>
      presentation === "circle" ? circle : line,
    expressionVersion: () => catalog.version,
    setDocument(
      presentation: "circle" | "line",
      document: FixtureDocument,
    ) {
      if (presentation === "circle") circle = document;
      else line = document;
      catalog.version++;
    },
  };
  return catalog as unknown as FakeCatalog;
}

function textBlock(
  id: string,
  text: string,
  start: number,
  stable = true,
): FixtureBlock {
  return {
    id,
    kind: "paragraph",
    sourceStart: start,
    sourceEnd: start + text.length,
    stable,
    inline: [
      {
        type: "text",
        text,
        sourceStart: start,
        sourceEnd: start + text.length,
      },
    ],
  };
}

const node = {
  id: "q0",
  name: "⌕₀",
  parent: null,
  title: "检索",
  expressions: { circle: "", line: "" },
  refs: [],
  children: [],
  hub: "Q",
} as Chapter;

const hub = {
  id: "Q",
  glyph: "⌕",
  theme: "dark",
  center: { x: 0, y: 0 },
  angle: 0,
  morph: 0.35,
  root: "q0",
  targetMorph: 0,
  fold: 1,
  scroll: 0,
  scrollTarget: 0,
  textOffset: 0,
  textOffsetTarget: 0,
  path: ["Q", "q0"],
  anchorOffset: 0,
  localScroll: 0,
  localScrollTarget: 0,
} as Hub;

function makeRenderer(catalog: Catalog) {
  return new ArticleRenderer(catalog, {
    inlineIcon: () =>
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    iconShowcase: () => {
      const grid = document.createElement("div");
      grid.className = "icon-showcase-grid";
      return grid;
    },
  });
}

test("syncArticle updates stable block ids in place and keeps focus, input and unchanged text nodes", () => {
  const dom = setup();
  const catalog = makeCatalog();
  const article = document.createElement("article");
  article.className = "note";
  document.body.append(article);
  const renderer = makeRenderer(catalog);
  try {
    catalog.setDocument(
      "circle",
      documentOf([textBlock("p1", "Alpha", 0), textBlock("p2", "Beta", 6)]),
    );
    renderer.fillArticle(article, node, hub, "circle");
    const content = article.querySelector(".note-content")!;
    const windowElement = article.querySelector(".note-window")!;
    const first = article.querySelector<HTMLElement>('[data-block-id="p1"]')!;
    const firstText = first.firstChild!;
    const observer = new dom.window.MutationObserver(() => {});
    observer.observe(first, { attributes: true, characterData: true, childList: true, subtree: true });
    const second = article.querySelector<HTMLElement>('[data-block-id="p2"]')!;
    const blockObserver = new dom.window.MutationObserver(() => {});
    blockObserver.observe(content, { childList: true });
    const input = article.querySelector<HTMLInputElement>(".hub-search-input")!;
    input.value = "检索正文";
    input.focus();
    input.setSelectionRange(2, 2);

    catalog.setDocument(
      "circle",
      documentOf([
        textBlock("p1", "Alpha", 0),
        textBlock("p2", "Beta and more", 6, false),
        textBlock("p3", "Gamma", 20),
      ]),
    );
    renderer.syncArticle(article, node, hub, "circle");

    const removals = blockObserver.takeRecords().flatMap(record => [...record.removedNodes]);
    blockObserver.disconnect();
    assert.ok(!removals.includes(first) && !removals.includes(second));
    assert.ok(article.querySelector(".note-window") === windowElement);
    assert.ok(article.querySelector(".note-content") === content);
    assert.ok(article.querySelector('[data-block-id="p1"]') === first);
    assert.ok(first.firstChild === firstText);
    assert.equal(observer.takeRecords().length, 0);
    observer.disconnect();
    assert.equal(firstText.textContent, "Alpha");
    assert.ok(article.querySelector('[data-block-id="p2"]') === second);
    assert.equal(second.textContent, "Beta and more");
    assert.equal(
      article.querySelector('[data-block-id="p3"]')?.textContent,
      "Gamma",
    );
    assert.ok(article.querySelector(".hub-search-input") === input);
    assert.ok(document.activeElement === input);
    assert.equal(input.selectionStart, 2);
    assert.equal(input.selectionEnd, 2);
  } finally {
    dom.close();
  }
});

test("streaming text appends to the same text node and converts a closed reference in place", () => {
  const dom = setup();
  const catalog = makeCatalog();
  const article = document.createElement("article");
  document.body.append(article);
  const renderer = makeRenderer(catalog);
  try {
    catalog.setDocument(
      "circle",
      documentOf([textBlock("p1", "Hello", 0, false)]),
    );
    renderer.syncArticle(article, node, hub, "circle");
    const paragraph = article.querySelector<HTMLElement>('[data-block-id="p1"]')!;
    const text = paragraph.firstChild as Text;

    catalog.setDocument(
      "circle",
      documentOf([textBlock("p1", "Hello world", 0, false)]),
    );
    renderer.syncArticle(article, node, hub, "circle");
    assert.equal(paragraph.firstChild, text);
    assert.equal(text.data, "Hello world");

    catalog.setDocument(
      "circle",
      documentOf([
        {
          id: "p1",
          kind: "paragraph",
          sourceStart: 0,
          sourceEnd: 16,
          stable: false,
          inline: [
            {
              type: "text",
              text: "Hello ",
              sourceStart: 0,
              sourceEnd: 6,
            },
            {
              type: "text",
              text: "{world|a0",
              sourceStart: 6,
              sourceEnd: 16,
            },
          ],
        },
      ]),
    );
    renderer.syncArticle(article, node, hub, "circle");
    const openText = paragraph.lastChild as Text;

    catalog.setDocument(
      "circle",
      documentOf([
        {
          id: "p1",
          kind: "paragraph",
          sourceStart: 0,
          sourceEnd: 17,
          stable: false,
          inline: [
            {
              type: "text",
              text: "Hello ",
              sourceStart: 0,
              sourceEnd: 6,
            },
            {
              type: "reference",
              text: "world",
              target: "a0",
              sourceStart: 6,
              sourceEnd: 17,
            },
          ],
        },
      ]),
    );
    renderer.syncArticle(article, node, hub, "circle");
    assert.equal(paragraph.firstChild, text);
    assert.equal(text.data, "Hello ");
    assert.equal(paragraph.contains(openText), false);
    const reference = paragraph.querySelector<HTMLButtonElement>(".inline-ref")!;
    assert.equal(reference.dataset.target, "a0");
    assert.match(reference.textContent ?? "", /world/);
    assert.equal(paragraph.querySelectorAll(".inline-ref").length, 1);
  } finally {
    dom.close();
  }
});

test("block.inline and listItem.inline/options keep the established article structure and CSS classes", () => {
  const dom = setup();
  const catalog = makeCatalog();
  const article = document.createElement("article");
  document.body.append(article);
  const renderer = makeRenderer(catalog);
  try {
    catalog.setDocument(
      "circle",
      documentOf([
        textBlock("intro", "Intro", 0),
        {
          id: "options",
          kind: "vertical-list",
          sourceStart: 10,
          sourceEnd: 40,
          stable: true,
          inline: [],
          items: [
            {
              id: "row1",
              key: "开关",
              sourceStart: 10,
              sourceEnd: 18,
              inline: [],
              options: [
                {
                  inline: [
                    {
                      type: "reference",
                      text: "景深",
                      target: "act:toggle_blur",
                      sourceStart: 20,
                      sourceEnd: 26,
                    },
                  ],
                },
              ],
            },
            {
              id: "row2",
              key: "说明",
              sourceStart: 30,
              sourceEnd: 38,
              inline: [
                {
                  type: "text",
                  text: "正文",
                  sourceStart: 32,
                  sourceEnd: 34,
                },
              ],
            },
          ],
        },
        {
          id: "icons",
          kind: "icons",
          sourceStart: 41,
          sourceEnd: 48,
          stable: true,
          inline: [],
        },
      ]),
    );
    renderer.syncArticle(article, node, hub, "circle");
    assert.ok(article.querySelector(".note-window > .note-content"));
    assert.ok(article.querySelector(".eyebrow"));
    assert.ok(article.querySelector("h2"));
    assert.ok(article.querySelector(".tail"));
    assert.ok(article.querySelector(".shuyra-list.is-vertical"));
    assert.equal(article.querySelector(".list-key")?.textContent, "开关");
    assert.ok(
      article.querySelector(".list-val.is-options .shuyra-list.is-horizontal"),
    );
    assert.ok(article.querySelector(".list-val.is-prose"));
    assert.ok(article.querySelector(".icon-showcase-grid"));
  } finally {
    dom.close();
  }
});

test("text layout cache reuses layouts, honors DOM measurement for a streaming block and clears on font invalidation", () => {
  const cache = new TextLayoutCache("font-a");
  const style = { font: "16px serif", lineHeight: 24 };
  const first = cache.layout("p1", "一段用于排版的文字", 320, style, {
    contentVersion: 1,
  });
  assert.ok(first.height > 0);
  assert.equal(first.fontVersion, "font-a");
  assert.equal(first.width, 320);
  assert.equal(first.cached, false);

  const second = cache.layout("p1", "一段用于排版的文字", 320, style, {
    contentVersion: 1,
  });
  assert.equal(second.cached, true);
  assert.equal(second.height, first.height);

  const streaming = cache.layout("p1", "正在流入的文字", 320, style, {
    contentVersion: 2,
    stable: false,
    domHeight: 42,
  });
  assert.equal(streaming.source, "dom");
  assert.equal(streaming.height, 42);
  assert.equal(streaming.cached, false);

  cache.invalidateFont("font-b");
  assert.equal(cache.fontVersion, "font-b");
  const after = cache.layout("p1", "一段用于排版的文字", 320, style, {
    contentVersion: 1,
  });
  assert.equal(after.cached, false);
  assert.equal(after.fontVersion, "font-b");
  assert.ok(estimateTextHeight("abc", 320, style) > 0);
});

test("estimateArticleHeight reports a positive stable estimate without DOM measurement", () => {
  const dom = setup();
  const catalog = makeCatalog();
  const article = document.createElement("article");
  document.body.append(article);
  const renderer = makeRenderer(catalog);
  try {
    catalog.setDocument(
      "circle",
      documentOf([
        textBlock("p1", "第一段稳定正文，用于估算阅读窗口高度。", 0),
        textBlock("p2", "第二段仍在接收中的正文。", 22, false),
      ]),
    );
    renderer.syncArticle(article, node, hub, "circle");
    const height = renderer.estimateArticleHeight(
      article,
      node,
      "circle",
      320,
    );
    assert.ok(height > 80);
    assert.equal(renderer.fontVersion, "initial");
    renderer.invalidateFonts("fonts-ready");
    assert.equal(renderer.fontVersion, "fonts-ready");
  } finally {
    dom.close();
  }
});

test("closed references become buttons only when their chapter or action target exists", () => {
  const dom = setup(), catalog = makeCatalog();
  const article = document.createElement("article");
  document.body.append(article);
  const renderer = makeRenderer(catalog);
  try {
    const raw = "{不存在的章节|missing} {不存在的动作|act:missing}";
    catalog.setDocument("circle", documentOf([{ id: "p", kind: "paragraph", sourceStart: 0, sourceEnd: raw.length, stable: true, inline: [
      { type: "reference", text: "不存在的章节", target: "missing", sourceStart: 0, sourceEnd: 15 },
      { type: "text", text: " ", sourceStart: 15, sourceEnd: 16 },
      { type: "reference", text: "不存在的动作", target: "act:missing", sourceStart: 16, sourceEnd: raw.length },
    ] }], raw));
    renderer.syncArticle(article, node, hub, "circle");
    assert.equal(article.querySelectorAll(".inline-ref").length, 0);
    assert.equal(article.querySelector("p")?.textContent, raw);
  } finally { dom.close(); }
});

test("switching both expressions repeatedly does not reuse the other expression's version", () => {
  const dom = setup(), catalog = makeCatalog();
  const article = document.createElement("article");
  document.body.append(article);
  const renderer = makeRenderer(catalog);
  try {
    catalog.setDocument("circle", documentOf([textBlock("p", "圆表达", 0)]));
    catalog.setDocument("line", documentOf([textBlock("p", "线表达", 0)]));
    for (const presentation of ["circle", "line", "circle", "line"] as const) {
      renderer.syncArticle(article, node, hub, presentation);
      assert.equal(article.dataset.presentation, presentation);
      assert.equal(article.querySelector("p")?.textContent, presentation === "circle" ? "圆表达" : "线表达");
    }
  } finally { dom.close(); }
});


test("replacing blocks retains source indexes for newly constructed detached paragraphs", async () => {
  const { rangeAtSource } = await import("../src/rendering/reading-anchor.ts");
  const dom = setup();
  try {
    const catalog = makeCatalog();
    const renderer = makeRenderer(catalog);
    const article = document.createElement("article");
    document.body.append(article);
    catalog.setDocument("circle", documentOf([textBlock("keep", "首段", 0), textBlock("remove", "旧段", 4)]));
    renderer.syncArticle(article, node, hub, "circle");
    catalog.setDocument("circle", documentOf([textBlock("keep", "首段", 0), textBlock("new-second", "新段落", 4), textBlock("new-third", "新的第三段", 9)]));
    renderer.syncArticle(article, node, hub, "circle");
    const third = article.querySelectorAll("p")[2];
    const location = rangeAtSource(article, 11)!;
    assert.ok(location.range.startContainer === third.firstChild, "replacement cleanup must retain the new paragraph's text index");
    assert.equal(location.range.startOffset, 2);
  } finally { dom.close(); }
});


test("binding another store invalidates an equal-numbered article version", async () => {
  const [{ Catalog: RealCatalog }, { ContentStore }, { hubDefinitions, rawContent }] = await Promise.all([
    import("../src/content/catalog.ts"), import("../src/content/store.ts"), import("../src/content/field.ts"),
  ]);
  const dom = setup();
  try {
    const catalog = new RealCatalog(hubDefinitions, rawContent);
    const renderer = makeRenderer(catalog);
    const article = document.createElement("article");
    document.body.append(article);
    renderer.syncArticle(article, catalog.get("a0"), hub, "circle");
    const version = catalog.expressionVersion("a0", "circle");
    const target = new ContentStore();
    target.publish("a0", "circle", "绑定后正文", true);
    catalog.bindContentStore(target);
    assert.equal(catalog.expressionVersion("a0", "circle"), version);
    renderer.syncArticle(article, catalog.get("a0"), hub, "circle");
    assert.equal(article.querySelector("p")!.textContent, "绑定后正文");
  } finally { dom.close(); }
});
