import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { ordinaryAndLocalAttachments } from "../src/application/attachments.ts";
import { buildSceneFrame } from "../src/geometry/scene-frame.ts";
import type { FieldState } from "../src/core/types.ts";
import { evaluateHubCurve } from "../src/geometry/graphics.ts";
import { PAPER } from "../src/core/palette.ts";
import { labelHitRegion } from "../src/geometry/labels.ts";

const cloneState = (state: FieldState): FieldState => JSON.parse(JSON.stringify(state));

function freeze(value: any): any {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
const finite = (value: any): boolean =>
  typeof value === "number"
    ? Number.isFinite(value)
    : value && typeof value === "object"
      ? Object.values(value).every(finite)
      : true;

function build(state: FieldState, catalog: Catalog, hoveredTarget: string | null = null) {
  const hub = state.hubs[state.focus],
    current = catalog.get(hub.path.at(-1)!);
  const focusedEntries = ordinaryAndLocalAttachments(
    hub,
    current,
    catalog.siblings(current.id, state.searchResults),
    state.camera,
    state.viewport,
  );
  return buildSceneFrame(state, catalog, {
    renderer: "svg",
    revision: 10,
    relationColor: "#986632",
    focusedEntries,
    locals: [],
    feedback: new Map(),
    hoveredTarget,
  });
}

test("pure scene frames work without DOM and preserve frozen input through line singularities", () => {
  assert.equal(typeof document, "undefined");
  const catalog = new Catalog(hubDefinitions, rawContent),
    field = new Field(catalog, { width: 1366, height: 820 });
  for (const morph of [0, 0.5, 0.999999, 1, 1.000001])
    for (const z of [0.6, 1.6]) {
      const state = cloneState(field.state);
      state.hubs[state.focus].morph = state.hubs[state.focus].targetMorph =
        morph;
      state.camera = { ...state.camera, z, rotation: 37 };
      const before = JSON.stringify(state);
      const { frame } = build(freeze(state), catalog);
      assert.equal(JSON.stringify(state), before);
      assert.equal(frame.revision, 10);
      assert.ok(finite(frame));
      assert.ok(frame.labels.length > 0);
    const beacons = frame.layers.find(layer => layer.id === "hubs")!.primitives.filter(primitive => primitive.type === "text");
    assert.ok(beacons.length > 0);
    for (const beacon of beacons) {
      assert.equal(beacon.fontFamily, "var(--font-symbol)");
      assert.equal(beacon.fontWeight, 620);
      assert.equal(beacon.stroke, PAPER[frame.visualTheme]);
      assert.equal(beacon.strokeWidth, 3.5);
      assert.equal(beacon.strokeScale, "screen");
    }
      assert.equal(frame.reading.length, 0);
      assert.equal(frame.background, null);
      for (const label of frame.labels) {
        const hit = labelHitRegion(label);
        if (hit)
          assert.ok(
            JSON.stringify(
              frame.hitRegions.find((item) => item.id === hit.id),
            ) === JSON.stringify(hit),
          );
      }
    }
});

test("pure scene frames preserve color-sweep masks and suppress same-theme portals", () => {
  const catalog = new Catalog(hubDefinitions, rawContent),
    field = new Field(catalog, { width: 1366, height: 820 });
  field.dispatch({ type: "navigate", target: "d0" });
  const duration = field.state.passage!.duration;
  for (const phase of [0, 0.25, 0.5, 0.75, 0.99]) {
    field.update(duration * phase, 20);
    const state = freeze(cloneState(field.state));
    const { frame } = build(state, catalog);
    assert.ok(finite(frame));
    assert.ok(frame.portal?.visible);
    assert.equal(frame.masks.length, 1);
    const sameTheme = cloneState(state);
    sameTheme.passage!.theme = sameTheme.passage!.sourceTheme;
    const result = build(freeze(sameTheme), catalog).frame;
    assert.equal(result.portal, null);
    assert.equal(result.masks.length, 0);
  }
});

test("resonating numeric hub strokes preserve the signature highlight color", () => {
  const catalog = new Catalog(hubDefinitions, rawContent), field = new Field(catalog, { width: 1366, height: 820 });
  for (const morph of [0, 1]) {
    field.state.hubs.B.morph = field.state.hubs.B.targetMorph = morph;
    const { frame, perception } = build(field.state, catalog, "hub:B");
    const curve = evaluateHubCurve(field.state.hubs.B, field.state.camera, field.state.viewport);
    assert.equal(perception.hubs.B.tier, "resonating");
    const primitive = frame.layers.find(layer => layer.id === "hubs")!.primitives.find(p =>
      curve.kind === "circle" ? p.type === "arc" && p.cx === curve.cx && p.cy === curve.cy && p.radius === curve.radius
        : p.type === "polyline" && JSON.stringify(p.points) === JSON.stringify(curve.points));
    assert.ok(primitive);
    assert.equal(primitive.stroke, perception.hubs.B.signature.accentColor);
  }
});
