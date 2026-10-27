import test from "node:test";
import assert from "node:assert/strict";
import { sampleFlow } from "../src/effects/flow-field.ts";
import { traceStreamline, flowSeeds } from "../src/effects/streamlines.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { nodeS, material } from "../src/geometry/field.ts";
test("base flow is finite, continuous and approximately divergence free", () => {
  const h = 0.01;
  for (const p of flowSeeds({ x: 0, y: 0 })) {
    const v = sampleFlow(p, 1200, []).velocity;
    assert.ok(Number.isFinite(v.x + v.y));
    const dx =
      (sampleFlow({ x: p.x + h, y: p.y }, 1200, []).velocity.x -
        sampleFlow({ x: p.x - h, y: p.y }, 1200, []).velocity.x) /
      (2 * h);
    const dy =
      (sampleFlow({ x: p.x, y: p.y + h }, 1200, []).velocity.y -
        sampleFlow({ x: p.x, y: p.y - h }, 1200, []).velocity.y) /
      (2 * h);
    assert.ok(Math.abs(dx + dy) < 1e-7);
  }
});
test("wave impulses perturb the local field and expire without residual motion", () => {
  const point = { x: 160, y: 0 },
    impulses = [{ center: { x: 0, y: 0 }, started: 0, maxRadius: 380 }];
  assert.notDeepEqual(
    sampleFlow(point, 800, impulses),
    sampleFlow(point, 800, []),
  );
  assert.deepEqual(
    sampleFlow(point, 2300, impulses),
    sampleFlow(point, 2300, []),
  );
  assert.ok(
    Number.isFinite(sampleFlow({ x: 0, y: 0 }, 800, impulses).velocity.x),
  );
});
test("streamline sampling is deterministic and bounded in length", () => {
  for (const seed of flowSeeds({ x: 0, y: 0 })) {
    const points = traceStreamline(seed, 2000, []);
    assert.deepEqual(points, traceStreamline(seed, 2000, []));
    assert.equal(points.length, 49);
    for (let i = 1; i < points.length; i++)
      assert.ok(
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        ) <= 22.00001,
      );
  }
});
test("zoom never changes mobile chapter world coordinates", () => {
  const f = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 390,
    height: 844,
  });
  const h = f.state.hubs.B;
  const before = material(h, nodeS(h, 0, 3, f.state.camera, f.state.viewport));
  f.zoom(1.7, { x: 195, y: 422 });
  const after = material(h, nodeS(h, 0, 3, f.state.camera, f.state.viewport));
  assert.deepEqual(after, before);
});
