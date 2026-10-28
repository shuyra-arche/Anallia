import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import {
  worldToScreen,
  screenToWorld,
  evaluateHubGeometry,
  material,
  outwardNormal,
  transformLocal,
  nodeS,
  arcOffsetS,
  frameFor,
  R,
} from "../src/geometry/field.ts";
const viewport = { width: 1896, height: 1016 };
const create = () =>
  new Field(new Catalog(hubDefinitions, rawContent), viewport);
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function settle(field: Field, start = 0) {
  for (let i = 1; i <= 80; i++) field.update(start + i * 20, 20);
}
test("single-label scrolling stays at the current depth, including input queued during morph", () => {
  const f = create();
  assert.equal(f.siblings().length, 1);
  assert.ok(f.selected().children.length > 0);
  const camera = { ...f.state.camera };
  for (const delta of [1, 1, -1, 5, -5]) f.dispatch({ type: "step", delta });
  assert.equal(f.selected().id, "a0");
  assert.equal(f.state.history.length, 0);
  assert.equal(f.state.contentTurn, null);
  assert.deepEqual(f.state.camera, camera);
  f.dispatch({ type: "morph" });
  f.dispatch({ type: "step", delta: 1 });
  settle(f);
  assert.equal(f.selected().id, "a0");
  f.dispatch({ type: "navigate", target: "a1" });
  settle(f, 1600);
  assert.equal(f.selected().id, "a1");
  f.dispatch({ type: "step", delta: 1 });
  settle(f, 3200);
  assert.equal(f.selected().id, "a2");
});
test("projection round trips under rotation and zoom", () => {
  for (const rotation of [-180, -75, 0, 36, 180])
    for (const z of [0.18, 0.54, 1, 2.4]) {
      const camera = { x: -365, y: 70, z, rotation },
        p = { x: 721, y: -430 };
      const q = screenToWorld(
        worldToScreen(p, camera, viewport),
        camera,
        viewport,
      );
      near(q.x, p.x);
      near(q.y, p.y);
    }
});
test("circle material remains on its hub radius", () => {
  const f = create(),
    h = f.hub;
  for (const s of [-900, -195, 0, 195, 900]) {
    const p = material(h, s);
    near(Math.hypot(p.x - h.center.x, p.y - h.center.y), R);
  }
});
test("line singularity stays finite on both sides", () => {
  const f = create();
  for (const u of [0, 0.999, 0.999999, 1, 1.000001, 1.001, 2]) {
    const g = evaluateHubGeometry(f.hub, f.state.camera, viewport, u);
    assert.ok(g.strokeD.length);
    assert.doesNotMatch(g.strokeD + g.sweptClipD, /NaN|Infinity/);
    for (const s of [-10000, 0, 10000]) {
      const p = material(f.hub, s, 0, u);
      assert.ok(Number.isFinite(p.x + p.y));
    }
  }
  const p = transformLocal(f.hub, { x: -R, y: 0 }, 1);
  assert.ok(Number.isFinite(p.x + p.y));
});
test("sweep changes from interior to complementary region", () => {
  const f = create();
  assert.ok(
    !evaluateHubGeometry(
      f.hub,
      f.state.camera,
      viewport,
      0,
    ).sweptClipD.startsWith("M-200"),
  );
  assert.ok(
    evaluateHubGeometry(
      f.hub,
      f.state.camera,
      viewport,
      2,
    ).sweptClipD.startsWith("M-200"),
  );
});
test("recursive navigation commits at the transition midpoint", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "a21" });
  assert.equal(f.selected().id, "a0");
  f.update(550, 20);
  assert.equal(f.selected().id, "a21");
  assert.deepEqual(f.hub.path, ["a0", "a2", "a21"]);
  settle(f, 550);
  assert.equal(f.state.passage, null);
});
test("cross-hub visits preserve independent reading paths", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "a21" });
  settle(f);
  f.dispatch({ type: "navigate", target: "b1" });
  settle(f, 1600);
  assert.equal(f.state.focus, "B");
  assert.deepEqual(f.state.hubs.A.path, ["a0", "a2", "a21"]);
  f.dispatch({ type: "back" });
  settle(f, 3200);
  assert.equal(f.state.focus, "A");
  assert.equal(f.selected().id, "a21");
});
test("up, siblings and repeated references retain semantic identity", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "a21" });
  settle(f);
  f.dispatch({ type: "step", delta: 1 });
  settle(f, 1600);
  assert.equal(f.selected().id, "a22");
  const morph = f.hub.targetMorph;
  f.dispatch({ type: "navigate", target: "a22" });
  assert.equal(f.hub.targetMorph, morph);
  f.dispatch({ type: "up" });
  settle(f, 3200);
  assert.equal(f.selected().id, "a2");
});
test("settings retain the reading theme without synthetic loading", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "s0" });
  settle(f);
  f.dispatch({ type: "navigate", target: "act:range12" });
  assert.equal(f.state.settings.range, 1.25);
  assert.equal(f.state.loading, false);
  assert.equal(f.state.theme, "dark");
  assert.equal(f.selected().id, "s0");
});

test("zoom keeps the pointer anchored in world coordinates", () => {
  const f = create(),
    at = { x: 870, y: 391 },
    before = screenToWorld(at, f.state.camera, viewport);
  f.zoom(1.7, at);
  const after = screenToWorld(at, f.state.camera, viewport);
  near(after.x, before.x);
  near(after.y, before.y);
});
test("morph targets are restored when returning through history", () => {
  const f = create();
  f.dispatch({ type: "morph" });
  settle(f);
  assert.equal(f.hub.targetMorph, 1);
  f.dispatch({ type: "overview" });
  settle(f, 1600);
  f.dispatch({ type: "back" });
  settle(f, 3200);
  assert.equal(f.hub.targetMorph, 1);
  assert.equal(f.state.overview, false);
});
test("catalog rejects duplicate IDs, cycles and invalid references", () => {
  const clone = () => structuredClone(rawContent);
  let rows = clone();
  rows.A.push(rows.A[0]);
  assert.throws(() => new Catalog(hubDefinitions, rows), /Duplicate/);
  rows = clone();
  rows.A[1][2] = "a21";
  rows.A[4][2] = "a1";
  assert.throws(() => new Catalog(hubDefinitions, rows), /Cycle/);
  rows = clone();
  rows.A[0][6].push(["bad", "missing"]);
  assert.throws(() => new Catalog(hubDefinitions, rows), /Unknown chapter/);
});
test("circle reading scroll pins the reading label while the center moves and user zoom stays unchanged", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "a1" });
  settle(f);
  f.zoom(1.4, { x: 800, y: 440 });
  const center = { ...f.hub.center },
    before = worldToScreen(
      material(
        f.hub,
        nodeS(
          f.hub,
          f.hub.scroll,
          f.siblings().length,
          f.state.camera,
          viewport,
        ),
        48,
      ),
      f.state.camera,
      viewport,
    ),
    centerBefore = worldToScreen(center, f.state.camera, viewport),
    zoom = f.state.camera.z;
  f.dispatch({ type: "step", delta: 1 });
  for (let i = 1; i <= 160; i++) {
    f.update(1600 + i * 20, 20);
    const after = worldToScreen(
      material(
        f.hub,
        nodeS(
          f.hub,
          f.hub.scroll,
          f.siblings().length,
          f.state.camera,
          viewport,
        ),
        48,
      ),
      f.state.camera,
      viewport,
    );
    near(after.x, before.x);
    near(after.y, before.y);
    near(f.state.camera.z, zoom);
    assert.deepEqual(f.hub.center, center);
  }
  const centerAfter = worldToScreen(center, f.state.camera, viewport);
  assert.ok(
    Math.hypot(centerAfter.x - centerBefore.x, centerAfter.y - centerBefore.y) >
      5,
  );
  assert.equal(f.selected().id, "a2");
});
test("line reading scroll keeps the entire camera state (x, y, z, rotation) completely unchanged", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "b1" });
  settle(f);
  f.zoom(1.3, { x: 900, y: 500 });
  f.pan({ x: 45, y: -30 }, { ...f.state.camera });
  const camBefore = { ...f.state.camera };
  f.dispatch({ type: "step", delta: 1 });
  for (let i = 1; i <= 80; i++) {
    f.update(1600 + i * 20, 20);
    assert.deepEqual(f.state.camera, camBefore);
  }
  assert.equal(f.selected().id, "b2");
});
test("reading animation settles completely instead of following forever", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "a1" });
  settle(f);
  f.dispatch({ type: "step", delta: 1 });
  assert.equal(f.isAnimating, true);
  for (let i = 1; i <= 220; i++) f.update(1600 + i * 20, 20);
  assert.equal(f.isAnimating, false);
  const camera = { ...f.state.camera };
  f.update(6020, 20);
  assert.deepEqual(f.state.camera, camera);
});
test("search hub updates perimeter labels in real time without moving q0 or camera", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "q0" });
  settle(f);
  assert.equal(f.state.focus, "Q");
  assert.equal(f.selected().id, "q0");
  const cameraBefore = { ...f.state.camera };
  const sBefore = nodeS(
    f.hub,
    0,
    f.siblings().length,
    f.state.camera,
    viewport,
  );
  near(sBefore, 0);
  for (const query of ["流", "流场", "圆轴", "长文", ""]) {
    f.dispatch({ type: "search", query });
    assert.equal(f.state.searchQuery, query);
    assert.equal(f.selected().id, "q0");
    assert.equal(f.isAnimating, false);
    assert.deepEqual(f.state.camera, cameraBefore);
    near(nodeS(f.hub, 0, f.siblings().length, f.state.camera, viewport), 0);
    assert.deepEqual(
      frameFor(f.hub, 0, f.siblings().length, f.state.camera, viewport),
      frameFor(f.hub, 0, 1, f.state.camera, viewport),
    );
  }
});
test("single-symbol brightness switches and hub-native confirmation layer work cleanly", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "act:toggle_blur" });
  assert.equal(f.state.settings.blur, 0);
  f.dispatch({ type: "navigate", target: "act:toggle_blur" });
  assert.equal(f.state.settings.blur, 1);
  f.dispatch({ type: "navigate", target: "s5_ok" });
  settle(f);
  assert.equal(f.selected().id, "s5_ok");
  assert.deepEqual(
    f.siblings().map((n) => n.name),
    ["✓", "✕"],
  );
  f.dispatch({ type: "navigate", target: "act:reset_defaults" });
  settle(f, 1600);
  assert.equal(f.selected().id, "s5");
  assert.equal(f.state.settings.range, 0.62);
});
test("arcOffsetS preserves exact uniform spacing for special nav labels at any scroll position", () => {
  const f = create();
  const h = f.hub;
  const baselinePairDist = (() => {
    const p0 = material(h, arcOffsetS(h, 0, -50), -38);
    const p1 = material(h, arcOffsetS(h, 0, 0), -38);
    return Math.hypot(p1.x - p0.x, p1.y - p0.y);
  })();
  for (const scrollIndex of [0, 2, 4, 6, 8]) {
    const focus = nodeS(h, scrollIndex, 9, f.state.camera, viewport);
    for (let i = -2; i < 2; i++) {
      const a = material(h, arcOffsetS(h, focus, i * 50), -38);
      const b = material(h, arcOffsetS(h, focus, (i + 1) * 50), -38);
      near(Math.hypot(b.x - a.x, b.y - a.y), baselinePairDist);
    }
  }
});
test("line labels and text blocks have zero tangential drift at any scroll position", () => {
  const f = create();
  const h = f.state.hubs.B; // B is in line mode (morph = 1)
  const n = outwardNormal(h, 0, 1);
  const t = { x: -n.y, y: n.x }; // unit tangent along the line
  for (const s of [-1200, -680, -340, 0, 340, 680, 1200]) {
    const anchor = material(h, s, 0, 1);
    for (const offset of [-38, 34, 104]) {
      const displaced = material(h, s, offset, 1);
      const diff = { x: displaced.x - anchor.x, y: displaced.y - anchor.y };
      const tangentialDrift = diff.x * t.x + diff.y * t.y;
      const normalDist = diff.x * n.x + diff.y * n.y;
      near(tangentialDrift, 0);
      near(normalDist, offset);
    }
  }
});
test("long text floats smoothly along label horizontal line and resets on chapter step", () => {
  const f = create();
  f.dispatch({ type: "navigate", target: "a4" });
  settle(f);
  assert.equal(f.selected().id, "a4");
  assert.equal(f.hub.textOffset, 0);
  f.dispatch({ type: "float-text", delta: 120, maxOffset: 260 });
  assert.equal(f.hub.textOffsetTarget, 120);
  settle(f, 1600);
  near(f.hub.textOffset, 120);
  f.dispatch({ type: "float-text", delta: 500, maxOffset: 260 });
  assert.equal(f.hub.textOffsetTarget, 260);
  f.dispatch({ type: "step", delta: -1 });
  assert.equal(f.hub.textOffsetTarget, 0);
});
