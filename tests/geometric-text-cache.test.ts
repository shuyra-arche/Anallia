import test from "node:test";
import assert from "node:assert/strict";
import { GeometricTextCache } from "../src/rendering/geometric-article.ts";
import { parseContent } from "../src/content/parser.ts";

test("geometric line cache preserves mixed text/reference sources and invalidates measurement inputs", () => {
  let calls = 0;
  const cache = new GeometricTextCache((text) => {
    calls++;
    return [
      { start: 0, end: 2 },
      { start: 2, end: text.length },
    ];
  });
  const block = parseContent("甲乙{引用|a1}尾🌏").blocks[0];
  const rows = cache.layout(block, "14px serif", 200, "v1");
  assert.equal(
    rows
      .flatMap((row) => row.runs)
      .map((run) => run.text)
      .join(""),
    "甲乙引用尾🌏",
  );
  assert.deepEqual(rows[1].runs[0], {
    text: "引用",
    target: "a1",
    start: 2,
    end: 9,
  });
  assert.equal(cache.layout(block, "14px serif", 200, "v1"), rows);
  assert.equal(calls, 1);
  cache.layout(block, "14px serif", 180, "v1");
  cache.layout(block, "16px serif", 180, "v1");
  cache.layout(block, "16px serif", 180, "v2");
  cache.layout(parseContent("新内容").blocks[0], "16px serif", 180, "v2");
  assert.equal(calls, 5);
});

test("geometric line cache absorbs orphan closing punctuation into the preceding line (Kinsoku)", () => {
  const cache = new GeometricTextCache((text) => [
    { start: 0, end: text.length - 1 },
    { start: text.length - 1, end: text.length },
  ]);
  const block = parseContent("第一行末尾{引用|a1}。").blocks[0];
  const rows = cache.layout(block, "14px serif", 200, "v1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runs.map((r) => r.text).join(""), "第一行末尾引用。");
});

test("synthetic list separators retain zero-length source ranges", () => {
  const block = parseContent("甲乙").blocks[0];
  block.inline = [
    { type: "text", text: "甲", sourceStart: 0, sourceEnd: 1 },
    { type: "text", text: "  ·  ", sourceStart: 1, sourceEnd: 1 },
    { type: "text", text: "乙", sourceStart: 1, sourceEnd: 2 },
  ];
  const cache = new GeometricTextCache(text => [{ start: 0, end: text.length }]);
  const rows = cache.layout(block, "14px serif", 200, "v1");
  assert.deepEqual(rows[0].runs.map(({ start, end }) => [start, end]), [[0, 1], [1, 1], [1, 2]]);
});
