import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  captureReadingAnchor,
  captureReadingSelection,
  clearIndexedRanges,
  indexTextRange,
  restoreReadingAnchor,
  restoreReadingSelection,
  updateIndexedRange,
} from "../src/rendering/reading-anchor.ts";

function setup() {
  const window = new Window({ width: 390, height: 844 });
  const saved = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    Element: (globalThis as Record<string, unknown>).Element,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    Element: window.Element,
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

function block(id: string, text: string, start: number) {
  const element = document.createElement("p");
  element.dataset.blockId = id;
  element.dataset.sourceStart = String(start);
  element.dataset.sourceEnd = String(start + text.length);
  const node = document.createTextNode(text);
  element.append(node);
  return { element, node };
}

test("source-position anchors survive appends and clamp when a replacement shortens the text", () => {
  const dom = setup();
  const article = document.createElement("article");
  const first = block("p1", "Hello world", 0);
  const second = block("p2", "Tail", 12);
  article.append(first.element, second.element);
  document.body.append(article);
  indexTextRange(article, first.node, 0, 11, "p1");
  indexTextRange(article, second.node, 12, 16, "p2");
  try {
    const anchor = captureReadingAnchor(article, {
      source: 6,
      scroller: null,
    })!;
    assert.equal(anchor.source, 6);
    assert.equal(anchor.blockId, "p1");

    const third = block("p3", "Below", 17);
    article.append(third.element);
    indexTextRange(article, third.node, 17, 22, "p3");
    const unchanged = restoreReadingAnchor(article, anchor, {
      scroller: null,
    });
    assert.equal(unchanged.source, 6);
    assert.equal(unchanged.clamped, false);
    assert.equal(unchanged.range?.startContainer, first.node);
    assert.equal(unchanged.range?.startOffset, 6);
    assert.ok(Math.abs(unchanged.delta) <= 2);

    first.node.data = "Hi";
    updateIndexedRange(article, first.node, 0, 2);
    first.element.dataset.sourceEnd = "2";
    const clamped = restoreReadingAnchor(article, anchor, {
      scroller: null,
    });
    assert.equal(clamped.source, 2);
    assert.equal(clamped.range?.startContainer, first.node);
    assert.equal(clamped.range?.startOffset, 2);
    assert.equal(clamped.clamped, true);
  } finally {
    clearIndexedRanges(article);
    dom.close();
  }
});

test("restoreReadingAnchor compensates DOM shifts through scrollTop only and ignores <=2px drift", () => {
  const dom = setup();
  const article = document.createElement("article");
  const first = block("p1", "Hello world", 0);
  article.append(first.element);
  document.body.append(article);
  indexTextRange(article, first.node, 0, 11, "p1");
  const scroller = document.createElement("div");
  document.body.append(scroller);
  const RangePrototype = dom.window.Range.prototype;
  const original = RangePrototype.getBoundingClientRect;
  let top = 10;
  RangePrototype.getBoundingClientRect = function () {
    return {
      top,
      y: top,
      bottom: top + 20,
      height: 20,
      left: 0,
      x: 0,
      right: 100,
      width: 100,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
  try {
    const anchor = captureReadingAnchor(article, {
      source: 6,
      scroller,
    })!;
    assert.equal(anchor.top, 10);
    top = 34;
    scroller.scrollTop = 0;
    const shifted = restoreReadingAnchor(article, anchor, {
      scroller,
      tolerance: 2,
    });
    assert.equal(shifted.delta, 24);
    assert.equal(shifted.adjusted, true);
    assert.equal(scroller.scrollTop, 24);

    scroller.scrollTop = 0;
    top = 11.5;
    const tolerated = restoreReadingAnchor(article, anchor, {
      scroller,
      tolerance: 2,
    });
    assert.equal(tolerated.adjusted, false);
    assert.equal(scroller.scrollTop, 0);
    assert.ok(Math.abs(tolerated.delta) <= 2);
  } finally {
    RangePrototype.getBoundingClientRect = original;
    clearIndexedRanges(article);
    dom.close();
  }
});

test("selection anchors are captured and restored through source positions", () => {
  const dom = setup();
  const article = document.createElement("article");
  const first = block("p1", "Hello world", 0);
  article.append(first.element);
  document.body.append(article);
  indexTextRange(article, first.node, 0, 11, "p1");
  try {
    const range = document.createRange();
    range.setStart(first.node, 2);
    range.setEnd(first.node, 8);
    const selection = dom.window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const captured = captureReadingSelection(article)!;
    assert.equal(captured.anchorSource, 2);
    assert.equal(captured.focusSource, 8);
    assert.equal(captured.collapsed, false);

    selection.removeAllRanges();
    assert.equal(restoreReadingSelection(article, captured), true);
    const restored = selection.getRangeAt(0);
    assert.equal(restored.startContainer, first.node);
    assert.equal(restored.startOffset, 2);
    assert.equal(restored.endOffset, 8);
  } finally {
    clearIndexedRanges(article);
    dom.close();
  }
});

test("missing preferred blocks fall back to the nearest clamped source position", () => {
  const dom = setup();
  const article = document.createElement("article");
  const first = block("p1", "Hello world", 0);
  article.append(first.element);
  document.body.append(article);
  indexTextRange(article, first.node, 0, 11, "p1");
  try {
    const anchor = captureReadingAnchor(article, {
      source: 9,
      scroller: null,
    })!;
    first.element.remove();
    const replacement = block("p9", "New", 0);
    article.append(replacement.element);
    indexTextRange(article, replacement.node, 0, 3, "p9");
    const restored = restoreReadingAnchor(article, anchor, {
      scroller: null,
    });
    assert.equal(restored.blockId, "p9");
    assert.equal(restored.source, 3);
    assert.equal(restored.range?.startContainer, replacement.node);
    assert.equal(restored.range?.startOffset, 3);
    assert.equal(restored.clamped, true);
  } finally {
    clearIndexedRanges(article);
    dom.close();
  }
});

test("replacement preserves the absolute source position when the old block shrinks across that position", () => {
  const dom = setup();
  const article = document.createElement("article");
  const first = block("p1", "A long first paragraph", 0);
  const second = block("p2", "Following text", 24);
  article.append(first.element, second.element);
  document.body.append(article);
  indexTextRange(article, first.node, 0, 22, "p1");
  indexTextRange(article, second.node, 24, 38, "p2");
  try {
    const anchor = captureReadingAnchor(article, { source: 6, scroller: null })!;
    first.node.data = "Hi";
    first.element.dataset.sourceEnd = "2";
    updateIndexedRange(article, first.node, 0, 2);
    second.element.dataset.sourceStart = "4";
    second.element.dataset.sourceEnd = "18";
    updateIndexedRange(article, second.node, 4, 18);
    const restored = restoreReadingAnchor(article, anchor, { scroller: null });
    assert.equal(restored.source, 6);
    assert.ok(restored.range?.startContainer === second.node);
    assert.equal(restored.range?.startOffset, 2);
  } finally { clearIndexedRanges(article); dom.close(); }
});
