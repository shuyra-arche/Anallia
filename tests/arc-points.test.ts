import test from "node:test";
import assert from "node:assert/strict";
import { arcPoints } from "../src/geometry/arc-points.ts";

const arc = {
  cx: 10,
  cy: 20,
  radius: 100,
  startAngle: 0,
  endAngle: Math.PI / 2,
};
test("numeric dashed arc sampling follows sweep direction and preserves endpoints", () => {
  const clockwise = arcPoints(arc),
    reverse = arcPoints({ ...arc, anticlockwise: true });
  assert.ok(Math.hypot(clockwise[0].x - 110, clockwise[0].y - 20) < 1e-9);
  assert.ok(
    Math.hypot(clockwise.at(-1)!.x - 10, clockwise.at(-1)!.y - 120) < 1e-9,
  );
  assert.ok(clockwise[1].y > 20);
  assert.ok(reverse[1].y < 20);
  assert.ok(reverse.length > clockwise.length * 2);
  for (const points of [clockwise, reverse])
    for (const p of points)
      assert.ok(Math.abs(Math.hypot(p.x - 10, p.y - 20) - 100) < 1e-9);
  const full = arcPoints({
    ...arc,
    startAngle: Math.PI,
    endAngle: 3 * Math.PI,
  });
  assert.ok(
    Math.hypot(full[0].x - full.at(-1)!.x, full[0].y - full.at(-1)!.y) < 1e-9,
  );
});
test("arc sampling has finite bounded work and rejects invalid or empty shapes", () => {
  const points = arcPoints({ ...arc, radius: 1e8, endAngle: 2 * Math.PI });
  assert.equal(points.length, 2049);
  assert.equal(arcPoints({ ...arc, endAngle: 0 }).length, 0);
  assert.equal(arcPoints({ ...arc, radius: 0 }).length, 0);
  assert.equal(arcPoints({ ...arc, cx: Infinity }).length, 0);
});
