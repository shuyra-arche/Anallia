import test from "node:test";
import assert from "node:assert/strict";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";

const create = () => new Field(new Catalog(hubDefinitions, rawContent), { width: 1200, height: 800 }, true);
function settle(field: Field, start = 0) {
  for (let i = 1; i <= 80; i++) field.update(start + i * 20, 20);
}

test("window remains the default and layout commands leave presentation and reading position intact", () => {
  const field = create();
  assert.equal(field.state.settings.readingLayoutMode, "window");
  for (const morph of [0, 1]) {
    field.hub.morph = field.hub.targetMorph = morph;
    field.hub.textOffset = field.hub.textOffsetTarget = 42;
    const before = structuredClone({ camera: field.state.camera, hub: field.hub, history: field.state.history });
    const expressions = { ...field.selected().expressions };
    for (const mode of ["geometric", "window"] as const) {
      field.dispatch({ type: "set-reading-layout", mode });
      assert.equal(field.state.settings.readingLayoutMode, mode);
      assert.deepEqual({ camera: field.state.camera, hub: field.hub, history: field.state.history }, before);
      assert.deepEqual(field.selected().expressions, expressions);
    }
  }
});

test("layout choice survives chapters, morph, cross-hub navigation and history; reset restores window", () => {
  const field = create();
  field.dispatch({ type: "navigate", target: "a1" });
  settle(field);
  field.dispatch({ type: "set-reading-layout", mode: "geometric" });
  field.dispatch({ type: "step", delta: 1 });
  settle(field, 1600);
  assert.equal(field.selected().id, "a2");
  assert.equal(field.state.settings.readingLayoutMode, "geometric");
  field.dispatch({ type: "morph" });
  settle(field, 3200);
  assert.equal(field.hub.morph, 1);
  assert.equal(field.state.settings.readingLayoutMode, "geometric");
  field.dispatch({ type: "navigate", target: "b0" });
  settle(field, 4800);
  assert.equal(field.state.focus, "B");
  field.dispatch({ type: "set-reading-layout", mode: "window" });
  field.dispatch({ type: "back" });
  settle(field, 6400);
  assert.equal(field.selected().id, "a2");
  assert.equal(field.state.settings.readingLayoutMode, "window");
  field.dispatch({ type: "set-reading-layout", mode: "geometric" });
  field.dispatch({ type: "navigate", target: "act:reset_defaults" });
  assert.equal(field.state.settings.readingLayoutMode, "window");
});
