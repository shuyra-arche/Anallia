import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { contentManifest } from "../src/content/generated/manifest.ts";
import { initialSearchIndex } from "../src/content/generated/search-index.ts";
import {
  buildSearchEntry,
  createLocalContentSource,
  createContentRuntime,
} from "../src/content/index.ts";

const root = new URL("../", import.meta.url);

test("generated manifest and search index are produced from the author data", () => {
  const authorHubs = JSON.parse(
    readFileSync(new URL("src/content/author/hubs.json", root), "utf8"),
  ) as { id: string; kind?: string }[];
  for (const hub of authorHubs) {
    const author = JSON.parse(
      readFileSync(new URL(`src/content/author/${hub.id}.json`, root), "utf8"),
    );
    assert.deepEqual(rawContent[hub.id], author);
    if (hub.kind === "search") continue;
    for (const [id, name, , title, circle, line] of author) {
      const entry = initialSearchIndex.find((item) => item.sourceId === id);
      assert.ok(entry, `missing search entry ${id}`);
      assert.deepEqual(
        entry,
        buildSearchEntry({ id, name, title, circle, line }),
      );
      assert.deepEqual(Object.keys(entry).sort(), [
        "circleEnd",
        "circleStart",
        "lineEnd",
        "lineStart",
        "searchText",
        "sourceId",
      ]);
      assert.equal("circle" in entry, false);
      assert.equal("line" in entry, false);
      assert.equal("haystack" in entry, false);
    }
  }
  assert.equal(
    contentManifest.searchIndex.length,
    initialSearchIndex.length,
  );
});

test("manifest catalog uses the complete initial index before any body loads", () => {
  const eager = new Catalog(hubDefinitions, rawContent);
  const lazy = new Catalog(hubDefinitions, contentManifest);
  assert.equal(lazy.get("a0").expressions.circle, "");
  assert.equal(lazy.document("a0", "circle").blocks.length, 0);
  for (const query of ["", "流场", "长文", "星空", "标签", "不存在"]) {
    assert.deepEqual(
      lazy.search(query).map((chapter) => chapter.id),
      eager.search(query).map((chapter) => chapter.id),
      query,
    );
  }
  lazy.updateExpression("a0", "circle", rawContent.A[0][4], true);
  assert.equal(lazy.get("a0").expressions.circle, rawContent.A[0][4]);
  assert.ok(lazy.document("a0", "circle").references.length > 0);
});

test("q_hit references the source expression and shares its document", () => {
  const catalog = new Catalog(hubDefinitions, rawContent);
  const mirror = catalog.get("q_hit_a0");
  const source = catalog.get("a0");
  assert.ok(mirror.expressions.circle.includes(source.expressions.circle));
  assert.equal(
    catalog.document("q_hit_a0", "circle"),
    catalog.document("a0", "circle"),
  );
  assert.equal(
    catalog.expressionVersion("q_hit_a0", "circle"),
    catalog.expressionVersion("a0", "circle"),
  );
  const before = mirror.expressions.circle;
  catalog.updateExpression("a0", "circle", "更新后的正文 {返回|a0}", true);
  const after = mirror.expressions.circle;
  assert.notEqual(after, before);
  assert.ok(after.endsWith("更新后的正文 {返回|a0}"));
});

test("updateExpression versions documents and only updates search when complete", () => {
  const catalog = new Catalog(hubDefinitions, rawContent);
  const before = catalog.expressionVersion("a1", "circle");
  catalog.updateExpression("a1", "circle", "临时 {标签|b0}", false);
  assert.equal(catalog.expressionVersion("a1", "circle"), before + 1);
  assert.equal(catalog.document("a1", "circle").complete, false);
  assert.equal(catalog.search("临时unique").length, 0);

  catalog.updateExpression("a1", "circle", "临时unique {标签|b0}", true);
  assert.equal(catalog.expressionVersion("a1", "circle"), before + 2);
  assert.equal(catalog.document("a1", "circle").complete, true);
  assert.equal(catalog.search("临时unique")[0].id, "q_hit_a1");

  catalog.updateExpression("a1", "circle", "未完成unique", false);
  assert.equal(catalog.search("未完成unique").length, 0);
  assert.equal(catalog.search("临时unique").length, 1);

  catalog.updateExpression("a1", "circle", "circleunique", true);
  catalog.updateExpression("a1", "line", "lineunique", true);
  assert.equal(catalog.search("circleunique")[0].id, "q_hit_a1");
  assert.equal(catalog.search("lineunique")[0].id, "q_hit_a1");
  assert.equal(catalog.search("临时unique").length, 0);
});

test("local source loads one hub on demand and preserves every expression byte", async () => {
  const source = createLocalContentSource({ chunkSize: 7 });
  const controller = new AbortController();
  const patches = [];
  for await (const patch of source.open("a0", "circle", controller.signal))
    patches.push(patch);
  assert.ok(patches.length > 1);
  assert.equal(
    patches.map((patch) => patch.text).join(""),
    rawContent.A[0][4],
  );
  assert.ok(patches.every((patch) => patch.type === "append"));

  controller.abort();
  const afterAbort = [];
  for await (const patch of source.open(
    "a0",
    "circle",
    controller.signal,
  ))
    afterAbort.push(patch);
  assert.deepEqual(afterAbort, []);
});

test("runtime exposes initial search, then commits streamed text into the catalog", async () => {
  const runtime = createContentRuntime();
  assert.ok(runtime.catalog.search("流场").length > 0);
  const expected = rawContent.M.find((row) => row[0] === "m3")![4];
  const request = runtime.start("m3", "circle");
  await request.ready;
  runtime.flush();
  await request.done;
  runtime.flush();
  assert.equal(runtime.catalog.get("m3").expressions.circle, expected);
  assert.ok(runtime.catalog.document("m3", "circle").references.length > 0);
  assert.ok(runtime.catalog.expressionVersion("m3", "circle") > 0);
});
