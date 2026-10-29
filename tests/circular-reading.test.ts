import test from "node:test";
import assert from "node:assert/strict";
import {
  circularReadingPose,
  circularReadingOpacity,
  circularReadingCamera,
  READING_LINE_STEP,
  READING_LINE_ANGLE,
  circularReadingSlots,
  READING_RING_CAPACITY,
} from "../src/geometry/circular-reading.ts";
import { worldToScreen } from "../src/geometry/field.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";

const create = () => {
  const rows = structuredClone(rawContent);
  rows.A[0][4] = "纯平面几何正文。".repeat(200);
  return new Field(
    new Catalog(
      hubDefinitions.map((hub) => ({
        ...hub,
        ...(hub.id === "A" ? { readingLayoutMode: "geometric" as const } : {}),
      })),
      rows,
    ),
    { width: 1200, height: 800 },
    true,
  );
};
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("all source rows stay on the same planar circle, including indices beyond a full turn", () => {
  const hub = create().hub;
  for (const index of [0, 1, 12, 50, 100, 1000]) {
    const pose = circularReadingPose(hub, 0, index, 450);
    near(
      Math.hypot(pose.point.x - hub.center.x, pose.point.y - hub.center.y),
      450,
    );
    near(
      pose.baselineAngle,
      hub.angle + (index * READING_LINE_ANGLE * 180) / Math.PI,
    );
  }
});

test("a full ring keeps upcoming text visible and fades the previous row", () => {
  assert.equal(circularReadingOpacity(4, 4), 1);
  assert.equal(circularReadingOpacity(0, 4), 0);
  assert.ok(circularReadingOpacity(43, 4, 40) >= 0.3);
  assert.equal(circularReadingOpacity(44, 4, 40), 0);
  assert.equal(circularReadingOpacity(4, 4.5, 40), 0.5);
  assert.ok(circularReadingOpacity(44, 4.5, 40) > 0);
});

test("reading rotates around the hub and moves the next row onto the current gaze ray", () => {
  const field = create(),
    before = { ...field.state.camera };
  const viewport = field.state.viewport;
  const first = circularReadingPose(field.hub, 0, 0, 450);
  const gaze = worldToScreen(first.point, before, viewport);
  const center = worldToScreen(field.hub.center, before, viewport);
  for (const row of [1, 12, 80]) {
    const nextPose = circularReadingPose(field.hub, 0, row, 450);
    const camera = circularReadingCamera(
      field.hub,
      first.baselineAngle,
      nextPose.baselineAngle,
      before,
    );
    const projectedCenter = worldToScreen(field.hub.center, camera, viewport);
    const projectedRow = worldToScreen(nextPose.point, camera, viewport);
    near(projectedCenter.x, center.x);
    near(projectedCenter.y, center.y);
    near(projectedRow.x, gaze.x);
    near(projectedRow.y, gaze.y);
    near(camera.z, before.z);
  }
});

test("short and long articles share compact spacing without stretching short text", () => {
  assert.equal(circularReadingSlots(8), READING_RING_CAPACITY);
  assert.equal(circularReadingSlots(1000), READING_RING_CAPACITY);
  const hub = create().hub,
    angle = (2 * Math.PI) / circularReadingSlots(8);
  const poses = Array.from({ length: 8 }, (_, row) =>
    circularReadingPose(hub, 0, row, 450, angle),
  );
  for (let i = 1; i < poses.length; i++)
    near(
      poses[i].baselineAngle - poses[i - 1].baselineAngle,
      (angle * 180) / Math.PI,
    );
  const innerGap = 2 * 271 * Math.sin(angle / 2);
  assert.ok(innerGap >= 22 && innerGap < 23);
});

test("reading advance uses the gaze after free rotation and keeps the hub center stable", () => {
  const field = create();
  field.setReadingRows("a0", "circle", 8);
  field.update(20, 20);
  const center = worldToScreen(
    field.hub.center,
    field.state.camera,
    field.state.viewport,
  );
  field.dispatch({
    type: "float-text",
    delta: READING_LINE_STEP,
    maxOffset: 10000,
  });
  field.update(40, 20);
  let current = worldToScreen(
    field.hub.center,
    field.state.camera,
    field.state.viewport,
  );
  near(current.x, center.x);
  near(current.y, center.y);
  const beforeFree = { ...field.state.camera };
  field.rotate(18);
  field.update(60, 20);
  near(field.state.camera.x, beforeFree.x);
  near(field.state.camera.y, beforeFree.y);
  const beforeRead = { ...field.state.camera };
  const first = circularReadingPose(
    field.hub,
    0,
    1,
    450,
    (2 * Math.PI) / circularReadingSlots(8),
  );
  const gaze = worldToScreen(first.point, beforeRead, field.state.viewport);
  field.dispatch({
    type: "float-text",
    delta: READING_LINE_STEP,
    maxOffset: 10000,
  });
  field.update(80, 20);
  const second = circularReadingPose(
    field.hub,
    0,
    2,
    450,
    (2 * Math.PI) / circularReadingSlots(8),
  );
  const after = worldToScreen(
    second.point,
    field.state.camera,
    field.state.viewport,
  );
  near(after.x, gaze.x);
  near(after.y, gaze.y);
  near(
    field.state.camera.rotation,
    beforeRead.rotation -
      (((2 * Math.PI) / circularReadingSlots(8)) * 180) / Math.PI,
  );
});
