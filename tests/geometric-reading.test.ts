import test from "node:test";
import assert from "node:assert/strict";
import type { Hub } from "../src/core/types.ts";
import { geometricReadingLines } from "../src/geometry/geometric-reading.ts";
import { layoutGeometricText } from "../src/rendering/geometric-text-layout.ts";
import { R } from "../src/geometry/field.ts";

const hub: Hub = {
  id: "static", glyph: "A", theme: "dark", root: "a", center: { x: 0, y: 0 },
  angle: 0, morph: 0, targetMorph: 0, fold: 0, scroll: 0, scrollTarget: 0,
  textOffset: 0, textOffsetTarget: 0, path: ["a"], anchorOffset: 0,
  localScroll: 0, localScrollTarget: 0,
};
const request = {
  hub, camera: { x: 0, y: 0, z: 1, rotation: 0 },
  viewport: { width: 1200, height: 800 }, startS: 0,
  lineCount: 4, lineSpacing: 24, offset: 20, maxWidth: 160,
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("circle rows have independent radial anchors and baselines at constant arc spacing", () => {
  const before = structuredClone(request);
  const rows = geometricReadingLines(request);
  rows.forEach((row, i) => {
    const theta = i * request.lineSpacing / R;
    near(row.anchor.x, 600 + (R + 20) * Math.cos(theta));
    near(row.anchor.y, 400 + (R + 20) * Math.sin(theta));
    near(row.baselineAngle, theta * 180 / Math.PI);
    near(row.availableWidth, 160);
    if (i) assert.ok(Math.hypot(row.anchor.x - rows[i-1].anchor.x, row.anchor.y - rows[i-1].anchor.y) > 24);
  });
  assert.deepEqual(request, before);
  assert.deepEqual(geometricReadingLines(request), rows);
});

test("tilted line spines move anchors along the spine but every text baseline stays screen horizontal", () => {
  for (const angle of [-170, -90, -33, 0, 42, 90, 170]) {
    for (const rotation of [-110, 0, 73]) {
      for (const z of [0.5, 1, 2]) {
        const rows = geometricReadingLines({ ...request, hub: { ...hub, morph: 1, angle },
          camera: { ...request.camera, rotation, z } });
        const radians = (angle + rotation) * Math.PI / 180;
        rows.forEach((row, i) => {
          assert.equal(row.baselineAngle, 0);
          if (i) {
            near(row.anchor.x - rows[i-1].anchor.x, -24 * Math.sin(radians));
            near(row.anchor.y - rows[i-1].anchor.y, 24 * Math.cos(radians));
          }
        });
      }
    }
  }
});

test("circle baselines include camera and hub rotation and remain upright", () => {
  for (const angle of [-270, -180, -90, 0, 90, 180, 270, 540]) {
    const row = geometricReadingLines({ ...request, hub: { ...hub, angle },
      camera: { ...request.camera, rotation: 31 }, lineCount: 1 })[0];
    assert.ok(row.baselineAngle >= -90 && row.baselineAngle < 90);
    const delta = (row.baselineAngle - angle - 31) * Math.PI / 180;
    near(Math.abs(Math.cos(delta)), 1);
  }
});

test("actual folded line geometry controls baselines independently of the content target", () => {
  const rows = geometricReadingLines({ ...request, hub: { ...hub, fold: 0.5, angle: 37 } });
  assert.ok(rows.every(row => row.baselineAngle === 0));
  const circle = geometricReadingLines({ ...request, hub: { ...hub, targetMorph: 1 } });
  assert.ok(circle[1].baselineAngle > 0);
});

test("available widths keep centered baseline endpoints within the viewport", () => {
  for (const morph of [0, 1]) for (const angle of [0, 45, 90, 135, 180]) {
    const rows = geometricReadingLines({ ...request, hub: { ...hub, morph, angle },
      viewport: { width: 440, height: 440 }, maxWidth: 1000 });
    for (const row of rows) {
      assert.ok(row.availableWidth >= 0 && row.availableWidth <= 1000);
      if (!row.availableWidth) continue;
      for (const sign of [-1, 1]) {
        const rad = row.baselineAngle * Math.PI / 180;
        const x = row.anchor.x + sign * row.availableWidth / 2 * Math.cos(rad);
        const y = row.anchor.y + sign * row.availableWidth / 2 * Math.sin(rad);
        assert.ok(x >= -1e-7 && x <= 440 + 1e-7);
        assert.ok(y >= -1e-7 && y <= 440 + 1e-7);
      }
    }
  }
  const edge = geometricReadingLines({ ...request, viewport: { width: 440, height: 440 }, lineCount: 1 })[0];
  near(edge.availableWidth, 10);
  const outside = geometricReadingLines({ ...request, camera: { ...request.camera, x: -5000 } });
  assert.ok(outside.every(row => row.availableWidth === 0));
});

test("static text preserves source order, Unicode content and half-open UTF-16 ranges", () => {
  const source = "标题🌏正文第二行";
  const lines = [
    { content: source.slice(0, 4), sourceRange: { start: 0, end: 4 } },
    { content: source.slice(4), sourceRange: { start: 4, end: source.length } },
  ];
  const before = structuredClone(lines);
  for (const morph of [0, 1]) {
    const rows = layoutGeometricText(lines, { ...request, hub: { ...hub, morph, angle: 30 } });
    assert.equal(rows.length, 2);
    assert.equal(rows.map(row => row.content).join(""), source);
    assert.deepEqual(rows.map(row => row.sourceRange), lines.map(line => line.sourceRange));
    rows[0].sourceRange.start = 1;
    assert.deepEqual(lines, before);
  }
  assert.deepEqual(layoutGeometricText([], request), []);
  const outside = layoutGeometricText(lines, { ...request, camera: { ...request.camera, x: -5000 } });
  assert.equal(outside.map(row => row.content).join(""), source);
  assert.ok(outside.every(row => row.availableWidth === 0));
});

test("invalid geometry and unordered source ranges fail explicitly", () => {
  for (const patch of [{ lineCount: -1 }, { lineCount: 1.5 }, { startS: NaN },
    { lineSpacing: 0 }, { offset: -1 }, { maxWidth: Infinity },
    { camera: { ...request.camera, z: 0 } }, { viewport: { width: 0, height: 800 } }]) {
    assert.throws(() => geometricReadingLines({ ...request, ...patch }), RangeError);
  }
  for (const sourceRange of [{ start: -1, end: 1 }, { start: 2, end: 1 }, { start: 0, end: NaN }]) {
    assert.throws(() => layoutGeometricText([{ content: "a", sourceRange }], request), RangeError);
  }
  assert.throws(() => layoutGeometricText([
    { content: "a", sourceRange: { start: 0, end: 2 } },
    { content: "b", sourceRange: { start: 1, end: 3 } },
  ], request), RangeError);
});
