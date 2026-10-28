import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  LOADING_STATIC_TIME,
  evaluateLoadingGeometry,
} from "../src/geometry/loading.ts";
import {
  SvgLoadingRenderer,
  arcPathData,
  circlePathData,
  polylinePathData,
} from "../src/rendering/loading.ts";

const makeGroup = () => {
  const window = new Window();
  const document = window.document;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(group);
  document.body.appendChild(svg);
  return { window, document, group: group as unknown as SVGGElement };
};

test("numeric primitives build finite SVG paths without parsing paths", () => {
  const circle = circlePathData({
    kind: "circle",
    id: "circle",
    index: 0,
    cx: 220,
    cy: 220,
    r: 70,
    opacity: 1,
    tone: "ink",
    weight: 6,
  });
  assert.match(circle, /^M290 220 A70 70 0 1 1 150 220 A70 70 0 1 1 290 220$/);
  const arc = arcPathData({
    kind: "arc",
    id: "arc",
    index: 0,
    cx: 100,
    cy: 100,
    r: 40,
    startAngle: 0,
    endAngle: (Math.PI * 4) / 3,
    clockwise: true,
    opacity: 1,
    tone: "arc",
    weight: 6,
  });
  assert.equal((arc.match(/ A40 40 /g) ?? []).length, 2);
  assert.doesNotMatch(arc, /NaN|Infinity/);
  const line = polylinePathData({
    kind: "polyline",
    id: "line",
    index: 0,
    points: [
      { x: 0, y: 1 },
      { x: 2, y: 3 },
    ],
    closed: false,
    opacity: 1,
    tone: "ink",
    weight: 6,
  });
  assert.equal(line, "M0 1 L2 3");
});

test("SVG backend consumes numeric loading geometry, updates in place and clears", () => {
  const { window, group } = makeGroup();
  let animationFrames = 0;
  let intervals = 0;
  const originalRaf = window.requestAnimationFrame;
  const originalInterval = window.setInterval;
  window.requestAnimationFrame = (() => {
    animationFrames += 1;
    return 0;
  }) as typeof window.requestAnimationFrame;
  window.setInterval = (() => {
    intervals += 1;
    return 0;
  }) as typeof window.setInterval;

  const renderer = new SvgLoadingRenderer(group);
  const pose = evaluateLoadingGeometry(LOADING_STATIC_TIME, {
    placement: {
      anchor: { x: 500, y: 300 },
      angle: 0.2,
      scale: 1,
      theme: "dark",
    },
  });
  window.document.documentElement.dataset.theme = "light";
  renderer.render(pose);
  const paths = [...group.querySelectorAll("path[data-loading-shape]")];
  assert.ok(paths.length >= 7);
  assert.equal(group.getAttribute("data-loading-theme"), "dark");
  assert.equal(window.document.documentElement.dataset.theme, "light");
  for (const path of paths)
    assert.doesNotMatch(path.getAttribute("d") ?? "", /NaN|Infinity/);
  const stableD = paths[0].getAttribute("d");

  renderer.render(pose);
  assert.equal(
    [...group.querySelectorAll("path[data-loading-shape]")].length,
    paths.length,
  );
  assert.equal(paths[0].getAttribute("d"), stableD);

  const early = evaluateLoadingGeometry(1.55, {
    placement: {
      anchor: { x: 500, y: 300 },
      angle: 0.2,
      scale: 1,
      theme: "dark",
    },
  });
  renderer.render(early);
  assert.equal(
    [...group.querySelectorAll("path[data-loading-shape]")].length,
    early.circles.length,
  );

  renderer.clear();
  assert.equal(group.querySelectorAll("path[data-loading-shape]").length, 0);
  assert.equal(group.getAttribute("data-loading-theme"), null);
  assert.equal(animationFrames, 0);
  assert.equal(intervals, 0);

  window.requestAnimationFrame = originalRaf;
  window.setInterval = originalInterval;
  window.close();
});
