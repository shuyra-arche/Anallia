import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { readerLocation, readerMotion, readerHint } from "../src/application/reader-navigation.ts";

const create = () => new Field(new Catalog(hubDefinitions, rawContent), { width: 390, height: 844 });
function settle(field: Field, start = 0) {
  for (let i = 1; i <= 100; i++) field.update(start + i * 20, 20);
}

test("navigation is a read-only projection across root, siblings, parent and history", () => {
  const field = create();
  const before = JSON.stringify(field.state);
  const root = readerLocation(field.state, field.catalog);
  assert.equal(root.kind, "reading");
  if (root.kind !== "reading") return;
  assert.equal(root.parent, null);
  assert.equal(root.child, "a1");
  assert.equal(root.total, 1);
  assert.equal(JSON.stringify(field.state), before);
  field.dispatch({ type: "navigate", target: root.child! });
  assert.equal(readerMotion(field.state).kind, "level");
  settle(field);
  field.dispatch({ type: "step", delta: 1 });
  settle(field, 2000);
  const second = readerLocation(field.state, field.catalog);
  assert.equal(second.kind, "reading");
  if (second.kind !== "reading") return;
  assert.equal(second.chapter, "a2");
  assert.equal(second.position, 1);
  assert.equal(second.parent, "a0");
  field.dispatch({ type: "back" });
  settle(field, 4000);
  assert.equal(field.selected().id, "a0");
});

test("overview and loading exclude local chapter operations; morph is separate from location", () => {
  const field = create();
  field.dispatch({ type: "morph" });
  assert.deepEqual(readerMotion(field.state), { kind: "morph", to: "line" });
  const location = readerLocation(field.state, field.catalog);
  assert.equal(location.kind, "reading");
  assert.match(readerHint(location, readerMotion(field.state)), /仍在当前章节/);
  settle(field);
  field.dispatch({ type: "overview" });
  const overview = readerLocation(field.state, field.catalog);
  assert.equal(overview.kind, "overview");
  assert.ok(!("child" in overview));
  if (overview.kind === "overview") {
    assert.equal(overview.destinations.length, 7);
    assert.ok(overview.destinations.every(item => field.state.hubs[item.hub]));
  }
  field.state.loading = true;
  assert.deepEqual(readerLocation(field.state, field.catalog), { kind: "loading" });
});

test("queued repeated morphs settle on the same chapter without creating new history", () => {
  const field = create();
  field.dispatch({ type: "morph" });
  field.dispatch({ type: "morph" });
  settle(field);
  settle(field, 2000);
  const location = readerLocation(field.state, field.catalog);
  assert.equal(location.kind, "reading");
  if (location.kind !== "reading") return;
  assert.equal(location.shape, "circle");
  assert.equal(location.chapter, "a0");
  assert.equal(field.state.history.length, 0);
  assert.equal(readerMotion(field.state).kind, "idle");
});
