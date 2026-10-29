import test from "node:test";
import assert from "node:assert/strict";
import { GeometricTextCache } from "../src/rendering/geometric-article.ts";
import { parseContent } from "../src/content/parser.ts";
import {
  readReadingLayout,
  saveReadingLayout,
} from "../src/platform/preferences.ts";

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

test("reading layout preference defaults safely and round trips", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(readReadingLayout(storage), "window");
  saveReadingLayout("geometric", storage);
  assert.equal(readReadingLayout(storage), "geometric");
  saveReadingLayout("window", storage);
  assert.equal(readReadingLayout(storage), "window");
  values.set("shuyra.reading-layout", "circle");
  assert.equal(readReadingLayout(storage), "window");
  const blocked = {
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
  };
  assert.equal(readReadingLayout(blocked), "window");
  assert.doesNotThrow(() => saveReadingLayout("geometric", blocked));
});
