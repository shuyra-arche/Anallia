import test from "node:test";
import assert from "node:assert/strict";
import { parseContent } from "../src/content/parser.ts";
import { matchContentAnchor, presentationAnchor } from "../src/core/reading-continuity.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";

test("content anchors survive inserted sections while retaining the within-block source", () => {
  const from = parseContent("开篇。\n\n唯一的共同段落，继续读这一句话。\n\n结尾。");
  const target = parseContent("新的引言很长。\n\n另一段引言。\n\n唯一的共同段落，继续读这一句话。\n\n其他结尾。");
  const source = from.source.indexOf("继续");
  assert.deepEqual(matchContentAnchor({ document: from, source }, target), { kind: "matched", source: target.source.indexOf("继续") });
  assert.deepEqual(matchContentAnchor({ document: target, source: target.source.indexOf("继续") }, from), { kind: "matched", source });
});

test("equal complete documents preserve repeated paragraphs; ambiguous blocks and positional ids do not match", () => {
  const from = parseContent("重复段落。\n\n重复段落。");
  assert.deepEqual(matchContentAnchor({ document: from, source: 8 }, parseContent(from.source)), { kind: "matched", source: 8 });
  assert.deepEqual(matchContentAnchor({ document: from, source: 8 }, parseContent("新的引言。\n\n重复段落。")), { kind: "unavailable" });
  assert.deepEqual(matchContentAnchor({ document: parseContent("甲段。"), source: 1 }, parseContent("乙段。")), { kind: "unavailable" });
});

test("streaming only matches stable blocks, and unrelated expressions recover their own validated bookmark", () => {
  const from = parseContent("正在读的完整段落。\n\n结尾。");
  const anchor = { document: from, source: 4 };
  assert.equal(matchContentAnchor(anchor, parseContent("正在读的完整段落。", false)).kind, "unavailable");
  assert.equal(matchContentAnchor(anchor, parseContent("正在读的完整段落。\n\n未完", false)).kind, "matched");
  const other = parseContent("另一份独立正文，已有自己的阅读位置。");
  assert.deepEqual(presentationAnchor(anchor, { document: other, source: 8 }, other), { source: 8, reason: "bookmark" });
  assert.deepEqual(presentationAnchor(anchor, { document: other, source: 8 }, parseContent("完全替换的内容。")), { source: 0, reason: "start" });
});

test("one structural transition owns morph, content and passage even under queued navigation and return", () => {
  const field = new Field(new Catalog(hubDefinitions, rawContent), { width: 1366, height: 820 });
  const assertExclusive = () => {
    const state = field.state;
    assert.equal([state.passage, state.morphTurn, state.contentTurn].filter(Boolean).length, state.transition.kind === "idle" ? 0 : 1);
  };
  field.dispatch({ type: "morph" });
  assert.equal(field.state.transition.kind, "morph");
  assert.throws(() => Object.assign(field.state, { passage: {} }), TypeError);
  field.dispatch({ type: "navigate", target: "a1" });
  for (let now = 20; now <= 4000; now += 20) { field.update(now, 20); assertExclusive(); }
  assert.equal(field.selected().id, "a1");
  field.dispatch({ type: "navigate", target: "b0" });
  assert.equal(field.state.transition.kind, "passage");
  field.dispatch({ type: "back" });
  for (let now = 4020; now <= 8000; now += 20) { field.update(now, 20); assertExclusive(); }
  assert.equal(field.selected().id, "a1");
  assert.equal(field.state.transition.kind, "idle");
});
