import test from "node:test";
import assert from "node:assert/strict";
import { buildStaticReader } from "../src/content-builder.ts";
import { Catalog } from "../src/content/catalog.ts";
import { Field } from "../src/application/field.ts";
import { tideLocalWindow } from "../src/demos/tide-local-window.ts";

test("dense local windows expose every stable child and use the existing field scroll owner", () => {
  const definition = buildStaticReader({
    entry: "root",
    hubs: [{ id: "A" }],
    chapters: [
      { id: "root", hub: "A", title: "Root", body: "Root" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        hub: "A",
        parent: "root",
        title: `Child ${i}`,
        body: "Body",
      })),
    ],
  });
  const catalog = new Catalog(
      definition.manifest.definitions,
      definition.manifest,
    ),
    field = new Field(catalog, { width: 320, height: 568 }, true);
  field.state.loading = false;
  field.setLocalScrollLimit(
    () => tideLocalWindow(field.state, catalog).maxScroll,
  );
  const found = new Set<string>();
  for (let i = 0; i < 20; i++) {
    field.hub.localScroll = i;
    for (const item of tideLocalWindow(field.state, catalog).visible)
      found.add(item.target);
  }
  assert.equal(found.size, 20);
  field.dispatch({ type: "scroll-local", delta: 100 });
  assert.equal(field.hub.localScrollTarget, 16);
  field.dispatch({ type: "scroll-local", delta: -100 });
  assert.equal(field.hub.localScrollTarget, 0);
  field.setLocalScrollLimit(null);
  field.dispatch({ type: "scroll-local", delta: 100 });
  assert.ok(
    field.hub.localScrollTarget < 16,
    "restores normal geometric band when edition unmounts",
  );
  field.state.viewport.height = 320;
  assert.equal(tideLocalWindow(field.state, catalog).count, 1);
  catalog.destroy();
});
