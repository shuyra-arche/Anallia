import test from "node:test";
import assert from "node:assert/strict";
import {
  cameraMatrix,
  canReuseUnderCamera,
} from "../src/geometry/camera-reuse.ts";
import { worldToScreen } from "../src/geometry/field.ts";
import type { CameraView } from "../src/geometry/camera-reuse.ts";
import type {
  CirclePrimitive,
  ArcPrimitive,
  PolylinePrimitive,
} from "../src/core/graphics.ts";

const first: CameraView = {
  camera: { x: 240, y: -30, z: 0.8, rotation: -65 },
  viewport: { width: 1366, height: 820 },
};
const second: CameraView = {
  camera: { x: -125, y: 150, z: 1.4, rotation: 40 },
  viewport: { width: 900, height: 700 },
};
const circle = (view: CameraView): CirclePrimitive => {
  const at = worldToScreen({ x: 20, y: 40 }, view.camera, view.viewport);
  return {
    type: "circle",
    cx: at.x,
    cy: at.y,
    radius: 70 * view.camera.z,
    stroke: "#123456",
    strokeWidth: 1.5 * view.camera.z,
    dash: [3 * view.camera.z, 2 * view.camera.z],
  };
};

test("camera reuse matches independent world projection through pan, zoom, rotation and viewport changes", () => {
  const m = cameraMatrix(first, second)!;
  for (const point of [
    { x: 0, y: 0 },
    { x: 1800, y: -520 },
    { x: -14, y: 230 },
  ]) {
    const a = worldToScreen(point, first.camera, first.viewport),
      b = worldToScreen(point, second.camera, second.viewport);
    assert.ok(
      Math.hypot(
        m.a * a.x + m.c * a.y + m.tx - b.x,
        m.b * a.x + m.d * a.y + m.ty - b.y,
      ) < 1e-9,
    );
  }
  assert.equal(
    canReuseUnderCamera(
      { ...circle(first), dash: undefined },
      { ...circle(second), dash: undefined },
      m,
    ),
    true,
  );
  // A circle's dashed paint starts at screen angle zero, independently of the camera.
  assert.equal(canReuseUnderCamera(circle(first), circle(second), m), false);
  const unrotated = {
    ...second,
    camera: { ...second.camera, rotation: first.camera.rotation },
  };
  assert.equal(
    canReuseUnderCamera(
      circle(first),
      circle(unrotated),
      cameraMatrix(first, unrotated)!,
    ),
    true,
  );
  const oldLine: PolylinePrimitive = {
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 200 },
    ].map((p) => worldToScreen(p, first.camera, first.viewport)),
    stroke: "#abc",
    strokeWidth: first.camera.z,
  };
  const newLine: PolylinePrimitive = {
    ...oldLine,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 200 },
    ].map((p) => worldToScreen(p, second.camera, second.viewport)),
    strokeWidth: second.camera.z,
  };
  assert.equal(canReuseUnderCamera(oldLine, newLine, m), true);
  const a: ArcPrimitive = {
    ...circle(first),
    type: "arc",
    startAngle: 0.2 + (first.camera.rotation * Math.PI) / 180,
    endAngle: 2 + (first.camera.rotation * Math.PI) / 180,
  };
  const b: ArcPrimitive = {
    ...circle(second),
    type: "arc",
    startAngle: 0.2 + (second.camera.rotation * Math.PI) / 180,
    endAngle: 2 + (second.camera.rotation * Math.PI) / 180,
  };
  assert.equal(canReuseUnderCamera(a, b, m), true);
  assert.equal(
    canReuseUnderCamera(a, { ...b, endAngle: b.endAngle + 2 * Math.PI }, m),
    false,
  );
});

test("camera reuse rejects changed shape, paint, clipping, large zoom and invalid cameras", () => {
  const m = cameraMatrix(first, second)!,
    a = circle(first),
    b = circle(second);
  for (const changed of [
    { ...b, radius: b.radius + 0.01 },
    { ...b, opacity: 0.5 },
    { ...b, stroke: "#fff" },
    { ...b, dash: [1, 2] },
    { ...b, strokeWidth: 0.01 },
  ])
    assert.equal(canReuseUnderCamera(a, changed, m), false);
  assert.equal(canReuseUnderCamera(a, b, { ...m, scale: 3 }), false);
  const line: PolylinePrimitive = {
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  };
  assert.equal(
    canReuseUnderCamera(line, { ...line, points: [{ x: 0, y: 0 }] }, m),
    false,
  );
  assert.equal(
    cameraMatrix({ ...first, camera: { ...first.camera, z: 0 } }, second),
    null,
  );
  assert.equal(
    cameraMatrix(first, { ...second, camera: { ...second.camera, x: NaN } }),
    null,
  );
});

test("whole hub arcs reuse camera rotation while dashed and partial arcs keep their phase", () => {
  const matrix = cameraMatrix(first, second)!;
  const before: ArcPrimitive = { ...circle(first), type: "arc", dash: undefined, startAngle: 0, endAngle: 2 * Math.PI };
  const after: ArcPrimitive = { ...circle(second), type: "arc", dash: undefined, startAngle: 0, endAngle: 2 * Math.PI };
  assert.equal(canReuseUnderCamera(before, after, matrix), true);
  assert.equal(canReuseUnderCamera({ ...before, dash: [3 * first.camera.z, 2 * first.camera.z] }, { ...after, dash: [3 * second.camera.z, 2 * second.camera.z] }, matrix), false);
  assert.equal(canReuseUnderCamera({ ...before, endAngle: Math.PI }, { ...after, endAngle: Math.PI }, matrix), false);
});

test("explicit view transforms reproject a retained camera with exactly one screen transform", async () => {
  const { cameraUnderTransform } = await import("../src/geometry/camera-reuse.ts");
  const held = { ...first, camera: { x: -70, y: 80, z: 1.1, rotation: -30 } };
  const matrix = cameraMatrix(first, second)!, result = cameraUnderTransform(held, matrix, second.viewport)!;
  for (const point of [{ x: 0, y: 0 }, { x: 110, y: -60 }, { x: 1800, y: 900 }]) {
    const before = worldToScreen(point, held.camera, held.viewport), after = worldToScreen(point, result, second.viewport);
    assert.ok(Math.hypot(after.x - (matrix.a * before.x + matrix.c * before.y + matrix.tx), after.y - (matrix.b * before.x + matrix.d * before.y + matrix.ty)) < 1e-9);
  }
});
