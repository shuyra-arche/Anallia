import test from "node:test";
import assert from "node:assert/strict";
import { planLocalBand, localVisible } from "../src/core/local-nav.ts";
import {
  hubToScreen,
  worldToScreen,
  material,
  nodeS,
} from "../src/geometry/field.ts";
import { chooseAdaptiveLayout } from "../src/core/layout.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
const fresh = () =>
  new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1200,
    height: 800,
  });
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
test("local labels are virtualized in a bounded part of ordinary-tag arc gap", () => {
  const band = planLocalBand(160, 12);
  assert.equal(band.direction, 1);
  assert.equal(band.capacity, 2);
  assert.equal(band.maxScroll, 10);
  assert.ok(localVisible(0, 0, band));
  assert.equal(localVisible(8, 0, band), null);
  assert.ok(localVisible(8, 7.5, band));
  assert.ok(localVisible(11, 10, band));
});
test("a first ordinary tag appends locals into the following gap instead of the empty preceding side", () => {
  const band = planLocalBand(145, 8);
  assert.equal(band.direction, 1);
  assert.equal(band.capacity, 2);
  assert.ok(band.maxScroll > 0);
});
test("local labels keep following sequence order for both narrow and open-ended gaps", () => {
  for (const gap of [50, 145, 260, null]) {
    const band = planLocalBand(gap, 8);
    assert.equal(band.direction, 1);
    assert.ok(localVisible(0, 0, band)!.arc > 0);
    assert.ok(band.maxScroll > 0);
    assert.ok(localVisible(7, band.maxScroll, band));
  }
});
test("layout leaves article full-width even if it extends past the viewport", () => {
  const v = { width: 320, height: 600 };
  const layout = chooseAdaptiveLayout({ x: 286, y: 540 }, v, 390, 850);
  assert.equal(layout.width, 390);
  assert.equal(layout.side, -1);
  assert.equal(layout.vertical, -1);
  assert.equal(layout.stacked, false);
  assert.ok(layout.left < 0);
});
test("hub local geometry and hub center distances scale with camera zoom", () => {
  const f = fresh(),
    h = f.hub,
    v = f.state.viewport;
  const a = nodeS(h, 0, f.siblings().length, f.state.camera, v),
    p = material(h, a),
    q = material(h, a, 52);
  const pixelDistance = (z: number) => {
    f.state.camera.z = z;
    const pScreen = hubToScreen(h, p, f.state.camera, v),
      qScreen = hubToScreen(h, q, f.state.camera, v);
    return Math.hypot(pScreen.x - qScreen.x, pScreen.y - qScreen.y);
  };
  near(pixelDistance(1.0), 52);
  near(pixelDistance(0.5), 26);
  near(pixelDistance(1.8), 93.6);
  const centerBefore = worldToScreen(
    h.center,
    { ...f.state.camera, z: 0.3 },
    v,
  );
  const centerAfter = worldToScreen(h.center, { ...f.state.camera, z: 1.2 }, v);
  assert.notDeepEqual(centerBefore, centerAfter);
});
test("changing local scroll does not dispatch a geometry morph, page turn or camera move", () => {
  const f = fresh();
  const cam = { ...f.state.camera };
  f.dispatch({ type: "scroll-local", delta: 2 });
  assert.deepEqual(f.state.camera, cam);
  assert.equal(f.state.morphTurn, null);
  assert.equal(f.state.contentTurn, null);
  assert.equal(f.state.passage, null);
});
test("all 9 hubs (A, B, C, D, E, L, M, S, Q) are valid and support axis/near/flight/remote transitions", () => {
  const f = fresh();
  assert.equal(f.catalog.definitions.length, 9);
  // B -> C has explicit parentHub: 'B' -> 'axis'
  f.dispatch({ type: "navigate", target: "b0" });
  for (let i = 1; i <= 90; i++) f.update(i * 20, 20);
  f.dispatch({ type: "navigate", target: "c0" });
  assert.equal(f.state.passage?.kind, "axis");
  for (let i = 91; i <= 180; i++) f.update(i * 20, 20);
  assert.equal(f.selected().id, "c0");
  // C -> L (12-node obsidian hub)
  f.dispatch({ type: "navigate", target: "l1" });
  assert.ok(f.state.passage);
  for (let i = 181; i <= 280; i++) f.update(i * 20, 20);
  assert.equal(f.selected().id, "l1");
  assert.equal(f.siblings().length, 12);
});
