import test from "node:test";
import assert from "node:assert/strict";
import {
  contentText,
  parseContent,
  type ReferenceInline,
} from "../src/core/content.ts";

const source = [
  "开场 {开始|a1} 与 {动作|act:pulse}。",
  "",
  "[hlist]",
  "{圆|b0} | {线|c0}",
  "",
  "[vlist]",
  "阅读 :: {长文|m3} | {星空|s6}",
  "说明 :: 不带走正文",
  "",
  "[icons]",
].join("\n");

test("parseContent exposes typed blocks, source ranges and references", () => {
  const document = parseContent(source);
  assert.deepEqual(
    document.blocks.map((block) => block.kind),
    ["paragraph", "horizontal-list", "vertical-list", "icons"],
  );
  assert.deepEqual(
    document.blocks.map((block) => source.slice(block.sourceStart, block.sourceEnd)),
    [
      "开场 {开始|a1} 与 {动作|act:pulse}。",
      "[hlist]\n{圆|b0} | {线|c0}",
      "[vlist]\n阅读 :: {长文|m3} | {星空|s6}\n说明 :: 不带走正文",
      "[icons]",
    ],
  );
  assert.ok(document.blocks.every((block) => block.stable));
  assert.equal(new Set(document.blocks.map((block) => block.id)).size, 4);
  assert.deepEqual(
    document.references.map((reference) => [reference.text, reference.target]),
    [
      ["开始", "a1"],
      ["动作", "act:pulse"],
      ["圆", "b0"],
      ["线", "c0"],
      ["长文", "m3"],
      ["星空", "s6"],
    ],
  );
  for (const reference of document.references) {
    assert.equal(
      source.slice(reference.sourceStart, reference.sourceEnd),
      `{${reference.text}|${reference.target}}`,
    );
    assert.ok(document.blocks.some((block) => block.id === reference.blockId));
  }
  assert.equal(contentText(document).includes("开始"), true);
  assert.equal(contentText(document).includes("{开始|a1}"), false);
});

test("incomplete references stay literal until a later chunk closes them", () => {
  const prefix = "正文 {跨块标签|a1";
  const partial = parseContent(prefix, false);
  assert.equal(partial.references.length, 0);
  assert.equal(partial.blocks.length, 1);
  assert.equal(partial.blocks[0].stable, false);
  assert.equal(partial.blocks[0].inline.length, 1);
  assert.equal(partial.blocks[0].inline[0].type, "text");
  assert.equal(partial.blocks[0].inline[0].text, prefix);
  const blockId = partial.blocks[0].id;

  const complete = parseContent(`${prefix}}\n\n下一段`, false);
  assert.equal(complete.blocks[0].id, blockId);
  assert.equal(complete.references.length, 1);
  assert.equal(complete.references[0].target, "a1");
  assert.equal(
    complete.blocks[0].inline
      .map((inline) => (inline.type === "reference" ? inline.text : inline.text))
      .join(""),
    "正文 跨块标签",
  );
  assert.equal(complete.blocks[1].stable, false);

  const settled = parseContent(`${prefix}}\n\n下一段`, true);
  assert.equal(settled.blocks[0].stable, true);
  assert.equal(settled.blocks[1].stable, true);
});

test("closed but malformed references remain literal text", () => {
  const document = parseContent("不闭合 {没有目标}", true);
  assert.equal(document.references.length, 0);
  assert.equal(
    document.blocks[0].inline.map((inline) => inline.text).join(""),
    "不闭合 {没有目标}",
  );
  const nested = parseContent("嵌套 {a|{b|c}}", true);
  assert.deepEqual(
    nested.references.map((reference) => reference.target),
    ["c"],
  );
});

test("block IDs and ranges are stable when the tail grows", () => {
  const first = parseContent("第一段\n\n第二段", false);
  const second = parseContent("第一段\n\n第二段继续\n\n第三段", true);
  assert.equal(first.blocks[0].id, second.blocks[0].id);
  assert.equal(first.blocks[1].id, second.blocks[1].id);
  assert.equal(first.blocks[0].sourceStart, 0);
  assert.equal(second.blocks[0].sourceEnd, 3);
  assert.equal(second.blocks[1].sourceStart, 5);
  assert.equal(second.blocks[1].sourceEnd, 10);
});

test("list items preserve key, value, options and absolute ranges", () => {
  const document = parseContent(source);
  const horizontal = document.blocks[1];
  assert.equal(horizontal.items?.length, 2);
  assert.equal(horizontal.items?.[0].inline[0].type, "reference");
  const vertical = document.blocks[2];
  assert.equal(vertical.items?.[0].key, "阅读");
  assert.equal(vertical.items?.[0].options?.length, 2);
  for (const item of [...(horizontal.items ?? []), ...(vertical.items ?? [])])
    for (const inline of item.inline)
      assert.equal(
        source.slice(inline.sourceStart, inline.sourceEnd),
        inline.type === "reference"
          ? `{${(inline as ReferenceInline).text}|${(inline as ReferenceInline).target}}`
          : inline.text,
      );
});
