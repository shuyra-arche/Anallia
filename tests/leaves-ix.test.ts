import test from "node:test";
import assert from "node:assert/strict";
import {
  createLeavesIxDemo,
  leavesIxPages,
} from "../src/demos/leaves-ix-content.ts";
import { contentManifest } from "../src/content/generated/manifest.ts";
import { Catalog } from "../src/content/catalog.ts";
import type { ContentSource, Presentation } from "../src/core/content.ts";

const collect = async (
  source: ContentSource,
  id: string,
  presentation: Presentation,
  signal = new AbortController().signal,
) => {
  let text = "";
  for await (const patch of source.open(id, presentation, signal))
    text = patch.type === "replace" ? patch.text : text + patch.text;
  return text;
};

test("IX demo extends the manifest immutably and all branch targets resolve", () => {
  const before = JSON.stringify(contentManifest);
  const demo = createLeavesIxDemo(contentManifest, { async *open() {} });
  const catalog = new Catalog(demo.manifest.definitions, demo.manifest);
  assert.equal(demo.entry, "ix-entry");
  assert.equal(catalog.definitions[0].root, "ix-entry");
  assert.equal(
    catalog.definitions.find((hub) => hub.id === "IX")?.readingLayoutMode,
    "geometric",
  );
  assert.equal(
    catalog.definitions.find((hub) => hub.id === "IX-N")?.readingLayoutMode,
    "geometric",
  );
  assert.equal(catalog.get("ix-note").hub, "IX-N");
  assert.equal(catalog.definitions.find((hub) => hub.id === "IX-V")?.morph, 1);
  for (const page of leavesIxPages) {
    for (const expression of [page.circle, page.line]) {
      for (const match of expression.matchAll(/\{[^{}|]+\|([^{}]+)\}/g))
        assert.ok(catalog.chapters.has(match[1]), match[1]);
    }
  }
  assert.equal(JSON.stringify(contentManifest), before);
  assert.equal(
    contentManifest.chapters.some((page) => page.id.startsWith("ix-")),
    false,
  );
});

test("IX source preserves both expressions, delegates ordinary content and respects cancellation", async () => {
  const calls: string[] = [];
  const demo = createLeavesIxDemo(contentManifest, {
    async *open(id) {
      calls.push(id);
      yield { type: "replace", text: "ordinary content" };
    },
  });
  for (const page of leavesIxPages)
    for (const presentation of ["circle", "line"] as const)
      assert.equal(
        await collect(demo.source, page.id, presentation),
        page[presentation],
      );
  assert.equal(await collect(demo.source, "a0", "circle"), "ordinary content");
  assert.deepEqual(calls, ["a0"]);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await collect(demo.source, "ix-entry", "circle", controller.signal),
    "",
  );
  assert.equal(
    await collect(demo.source, "a0", "circle", controller.signal),
    "",
  );
  assert.deepEqual(calls, ["a0"]);
});
