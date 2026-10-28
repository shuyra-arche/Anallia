import test from "node:test";
import assert from "node:assert/strict";
import {
  L_C,
  L_RADII,
  LOADING_STATIC_TIME,
  evaluateLoadingGeometry,
  evaluateLoadingPose,
  loadingCurve,
  loadingMobiusPoint,
  loadingRotateCircle,
  loadingStableCircle,
} from "../src/geometry/loading.ts";

const close = (actual: number, expected: number, epsilon = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} is not within ${epsilon} of ${expected}`,
  );
};

const finiteNumbers = (value: unknown, path = "geometry"): void => {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => finiteNumbers(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value))
      finiteNumbers(entry, `${path}.${key}`);
  }
};

test("loading keeps the V24 tangent circles and Mobius main formula", () => {
  assert.deepEqual([...L_C], [-9 / 14, -2 / 7, 3 / 7]);
  assert.deepEqual([...L_RADII], [140, 70, 35]);

  for (const side of ["left", "right"] as const) {
    const circles = L_RADII.map((_, index) => loadingStableCircle(side, index));
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const distance = Math.hypot(
          circles[i].cx - circles[j].cx,
          circles[i].cy - circles[j].cy,
        );
        close(distance, Math.abs(circles[i].r - circles[j].r));
      }
    }
    const tangentX = side === "left" ? 80 : 360;
    for (const circle of circles)
      close(
        side === "left" ? circle.cx - circle.r : circle.cx + circle.r,
        tangentX,
      );
  }

  close(loadingMobiusPoint(-1, L_C[0], 0).x, 360);
  close(loadingMobiusPoint(-1, L_C[0], 0).y, 220);
  close(loadingMobiusPoint(0, L_C[0], 0).x, 155.71428571428572);
  close(loadingMobiusPoint(0, L_C[0], 0).y, 220);
  close(loadingMobiusPoint(1, L_C[0], 0).x, 80);
  close(loadingMobiusPoint(1, L_C[0], 0).y, 220);

  const curve = loadingCurve(0.5, 0);
  close(curve.cx, 465.3241902716925, 1e-9);
  close(curve.cy, 353.42309156267225, 1e-9);
  close(curve.r, 333.92503846703517, 1e-9);

  const rotated = loadingRotateCircle(loadingStableCircle("left", 0), Math.PI);
  close(rotated.cx, 220);
  close(rotated.cy, 220);
  close(rotated.r, 140);
});

test("stable pose exposes numeric circles, arcs and point lists", () => {
  const geometry = evaluateLoadingGeometry(LOADING_STATIC_TIME, {
    placement: {
      anchor: { x: 100, y: 50 },
      angle: Math.PI / 2,
      scale: 0.5,
      theme: "dark",
    },
  });
  assert.equal(geometry.circles.length, 3);
  assert.equal(geometry.theme, "dark");
  assert.deepEqual(geometry.placement.anchor, { x: 100, y: 50 });
  const expected = [
    { cx: 100, cy: 50, r: 70 },
    { cx: 100, cy: 15, r: 35 },
    { cx: 100, cy: -2.5, r: 17.5 },
  ];
  geometry.circles.forEach((circle, index) => {
    close(circle.cx, expected[index].cx);
    close(circle.cy, expected[index].cy);
    close(circle.r, expected[index].r);
  });
  assert.ok(geometry.arcs.length >= 4);
  for (const arc of geometry.arcs) {
    assert.equal(arc.clockwise, true);
    assert.ok(arc.endAngle > arc.startAngle);
    assert.ok(arc.r > 0);
  }
  assert.deepEqual(
    Object.keys(geometry).filter((key) => key === "d" || key === "path"),
    [],
  );
  finiteNumbers(geometry);
});

test("the loop remains finite and closed without assuming a successful task", () => {
  for (let time = 0; time <= 14; time += 0.08) {
    const geometry = evaluateLoadingGeometry(time, {
      placement: {
        anchor: { x: 600, y: 400 },
        angle: -0.7,
        scale: 1.4,
        theme: "celadon",
      },
      phase: "streaming",
    });
    finiteNumbers(geometry, `geometry@${time.toFixed(2)}`);
  }
  const pose = evaluateLoadingPose(0.6);
  assert.ok(pose.arcs.length > 0);
  assert.ok(pose.points.length > 0);
});

test("exit starts from the current posture and fades within the terminal window", () => {
  const at = 4.35;
  const current = evaluateLoadingGeometry(at, { phase: "streaming" });
  const startExit = evaluateLoadingGeometry(at, {
    phase: "leaving",
    exit: 0,
  });
  assert.deepEqual(startExit.circles, current.circles);
  assert.deepEqual(startExit.arcs, current.arcs);
  assert.deepEqual(startExit.points, current.points);
  const halfway = evaluateLoadingGeometry(at, {
    phase: "leaving",
    exit: 0.5,
  });
  assert.equal(halfway.opacity, 0.5);
  assert.ok(halfway.circles[0].r < current.circles[0].r);
  const done = evaluateLoadingGeometry(at, {
    phase: "leaving",
    exit: 1,
  });
  assert.equal(done.opacity, 0);
});

test("reduced motion uses one static posture instead of a slow loop", () => {
  const first = evaluateLoadingGeometry(0.25, {
    reducedMotion: true,
    streaming: true,
  });
  const later = evaluateLoadingGeometry(12, {
    reducedMotion: true,
    streaming: true,
  });
  assert.equal(first.time, LOADING_STATIC_TIME);
  assert.equal(later.time, LOADING_STATIC_TIME);
  assert.deepEqual(first.circles, later.circles);
  assert.deepEqual(first.arcs, later.arcs);
  assert.deepEqual(first.points, later.points);
  assert.equal(first.circles.length, 3);
});

test("every sampled posture enters the exit blend without a jump", () => {
  for (let time = 0; time <= 12; time += 0.1) {
    const current = evaluateLoadingGeometry(time, { phase: "streaming" });
    const entry = evaluateLoadingGeometry(time, {
      phase: "leaving",
      exit: 0,
    });
    assert.deepEqual(entry.circles, current.circles);
    assert.deepEqual(entry.arcs, current.arcs);
    assert.deepEqual(entry.points, current.points);
    const halfway = evaluateLoadingGeometry(time, {
      phase: "leaving",
      exit: 0.5,
    });
    assert.equal(halfway.opacity, 0.5);
    assert.ok(
      halfway.circles.every(
        (circle, index) => circle.r < current.circles[index].r,
      ),
    );
    const gone = evaluateLoadingGeometry(time, {
      phase: "leaving",
      exit: 1,
    });
    assert.equal(gone.opacity, 0);
  }
});

test("loop wrap keeps the tangent posture continuous", () => {
  const end = evaluateLoadingGeometry(7.58 - 1e-5, { phase: "streaming" });
  const start = evaluateLoadingGeometry(2.13 + 1e-5, { phase: "streaming" });
  assert.equal(end.circles.length, start.circles.length);
  assert.equal(end.circles.length, 3);
  end.circles.forEach((circle, index) => {
    close(circle.cx, start.circles[index].cx, 1e-3);
    close(circle.cy, start.circles[index].cy, 1e-3);
    close(circle.r, start.circles[index].r, 1e-3);
  });
  for (let i = 0; i < 3; i++) {
    const a = loadingStableCircle("left", i);
    const b = loadingStableCircle("left", i);
    close(a.cx, b.cx);
    close(a.cy, b.cy);
    close(a.r, b.r);
    const rotated = loadingRotateCircle(a, Math.PI * 0.37);
    close(
      Math.hypot(rotated.cx - 220, rotated.cy - 220),
      Math.hypot(a.cx - 220, a.cy - 220),
    );
    close(rotated.r, a.r);
  }
});
