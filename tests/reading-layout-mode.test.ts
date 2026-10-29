import test from "node:test";
import assert from "node:assert/strict";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";

const create = () =>
  new Field(
    new Catalog(hubDefinitions, rawContent),
    { width: 1200, height: 800 },
    true,
  );
function settle(field: Field, start = 0) {
  for (let i = 1; i <= 80; i++) field.update(start + i * 20, 20);
}

test("layout is a hub attribute and defaults to window independently of presentation", () => {
  const field = create();
  assert.equal("readingLayoutMode" in field.state.settings, false);
  assert.ok(
    Object.values(field.state.hubs).every(
      (hub) => hub.readingLayoutMode === "window",
    ),
  );
  for (const morph of [0, 1]) {
    field.hub.morph = field.hub.targetMorph = morph;
    field.hub.textOffset = field.hub.textOffsetTarget = 42;
    const before = structuredClone({
      camera: field.state.camera,
      hub: field.hub,
      history: field.state.history,
    });
    const expressions = { ...field.selected().expressions };
    for (const mode of ["geometric", "window"] as const) {
      field.dispatch({ type: "set-reading-layout", hub: field.hub.id, mode });
      assert.equal(field.hub.readingLayoutMode, mode);
      assert.deepEqual(
        {
          camera: field.state.camera,
          hub: field.hub,
          history: field.state.history,
        },
        { ...before, hub: { ...before.hub, readingLayoutMode: mode } },
      );
      assert.deepEqual(field.selected().expressions, expressions);
      assert.equal(field.state.hubs.B.readingLayoutMode, "window");
    }
  }
});

test("each hub retains its own layout through chapters, morph, cross-hub navigation and history", () => {
  const field = create();
  field.dispatch({ type: "navigate", target: "a1" });
  settle(field);
  field.dispatch({ type: "set-reading-layout", hub: "A", mode: "geometric" });
  field.dispatch({ type: "step", delta: 1 });
  settle(field, 1600);
  assert.equal(field.selected().id, "a2");
  assert.equal(field.hub.readingLayoutMode, "geometric");
  field.dispatch({ type: "morph" });
  settle(field, 3200);
  assert.equal(field.hub.morph, 1);
  assert.equal(field.hub.readingLayoutMode, "geometric");
  field.dispatch({ type: "navigate", target: "b0" });
  settle(field, 4800);
  assert.equal(field.state.focus, "B");
  assert.equal(field.hub.readingLayoutMode, "window");
  field.dispatch({ type: "set-reading-layout", hub: "B", mode: "geometric" });
  field.dispatch({ type: "back" });
  settle(field, 6400);
  assert.equal(field.selected().id, "a2");
  assert.equal(field.hub.readingLayoutMode, "geometric");
  field.dispatch({ type: "set-reading-layout", hub: "A", mode: "window" });
  field.dispatch({ type: "navigate", target: "b0" });
  settle(field, 8000);
  assert.equal(field.hub.readingLayoutMode, "geometric");
  assert.equal(field.state.hubs.A.readingLayoutMode, "window");
});

test("hub definitions declare layout and global settings reset leaves hub attributes intact", () => {
  const definitions = hubDefinitions.map((hub) => ({
    ...hub,
    ...(hub.id === "A" ? { readingLayoutMode: "geometric" as const } : {}),
  }));
  const field = new Field(
    new Catalog(definitions, rawContent),
    { width: 1200, height: 800 },
    true,
  );
  assert.equal(field.state.hubs.A.readingLayoutMode, "geometric");
  assert.equal(field.state.hubs.B.readingLayoutMode, "window");
  field.dispatch({ type: "navigate", target: "act:reset_defaults" });
  assert.equal(field.state.hubs.A.readingLayoutMode, "geometric");
  field.dispatch({ type: "set-reading-layout", hub: "A", mode: "window" });
  assert.equal(
    definitions.find((hub) => hub.id === "A")?.readingLayoutMode,
    "geometric",
  );
});

test("layout commands target an explicit hub and ignore missing hub ids", () => {
  const field = create();
  field.dispatch({ type: "set-reading-layout", hub: "B", mode: "geometric" });
  assert.equal(field.state.focus, "A");
  assert.equal(field.state.hubs.B.readingLayoutMode, "geometric");
  assert.equal(field.state.hubs.A.readingLayoutMode, "window");
  const before = structuredClone(field.state);
  field.dispatch({
    type: "set-reading-layout",
    hub: "missing",
    mode: "geometric",
  });
  assert.deepEqual(field.state, before);
});
