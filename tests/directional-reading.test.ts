import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import { placeReading } from "../src/core/layout.ts";
import { Scene } from "../src/rendering/scene.ts";
import {
  material,
  nodeS,
  outwardNormal,
  worldToScreen,
} from "../src/geometry/field.ts";
import { rot, unwrapAngle } from "../src/core/math.ts";

const make = (width = 708, height = 884) =>
  new Field(new Catalog(hubDefinitions, rawContent), { width, height });
const advance = (f: Field) => {
  let now = 0;
  return () => {
    for (let i = 0; i < 100; i++) f.update((now += 20), 20);
  };
};
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.02, `${a} != ${b}`);

test("upright reading windows remain outside every circle tangent and diagonal line, independent of screen edges", () => {
  for (let deg = -180; deg <= 180; deg += 3) {
    const n = {
      x: Math.cos((deg * Math.PI) / 180),
      y: Math.sin((deg * Math.PI) / 180),
    };
    for (const scale of [0.18, 1.12, 2.4]) {
      const a = { x: 100, y: 180 };
      const p = placeReading(a, n, 320, 540, scale);
      for (const x of [p.left, p.left + 320 * scale])
        for (const y of [p.top, p.top + 540 * scale])
          assert.ok((x - a.x) * n.x + (y - a.y) * n.y > -1e-7);
      const shifted = placeReading(
        { x: a.x + 1800, y: a.y - 900 },
        n,
        320,
        540,
        scale,
      );
      near(shifted.left - p.left, 1800);
      near(shifted.top - p.top, -900);
      assert.equal(shifted.side, p.side);
    }
  }
});

test("reading placement is continuous across the top and bottom of a circle", () => {
  for (const pole of [90, 270]) {
    let prior = null;
    for (let angle = pole - 2; angle <= pole + 2; angle += 0.05) {
      const n = {
        x: Math.cos((angle * Math.PI) / 180),
        y: Math.sin((angle * Math.PI) / 180),
      };
      const p = placeReading({ x: 400, y: 400 }, n, 355, 700);
      if (prior)
        assert.ok(Math.hypot(p.left - prior.left, p.top - prior.top) < 2);
      prior = p;
    }
  }
});

test("entry direction sets the line normal and is stable while scrolling; history restores its orientation", () => {
  const f = make(),
    settle = advance(f);
  f.dispatch({ type: "navigate", target: "b1" });
  settle();
  const bearing = f.hub.readingBearing!,
    angle = f.hub.angle;
  const normal = rot(
    outwardNormal(f.hub, 0),
    (f.state.camera.rotation * Math.PI) / 180,
  );
  assert.ok(
    normal.x < -0.9,
    "approaching B from A opens the article to the left",
  );
  assert.ok(Math.abs(normal.y) > 0.01, "the line retains the oblique approach");
  const camera = { ...f.state.camera };
  f.dispatch({ type: "step", delta: 1 });
  settle();
  assert.deepEqual(f.state.camera, camera);
  assert.equal(f.hub.readingBearing, bearing);
  assert.equal(f.hub.angle, angle);
  f.dispatch({ type: "navigate", target: "l0" });
  settle();
  f.dispatch({ type: "navigate", target: "b0" });
  settle();
  const otherNormal = rot(
    outwardNormal(f.hub, 0),
    (f.state.camera.rotation * Math.PI) / 180,
  );
  assert.ok(
    otherNormal.x > 0,
    "approaching B from L opens toward the opposite side",
  );
  f.dispatch({ type: "back" });
  settle();
  f.dispatch({ type: "back" });
  settle();
  assert.equal(f.state.focus, "B");
  near(f.hub.angle, angle);
  near(f.hub.readingBearing!, bearing);
  assert.equal(f.selected().id, "b2");
});

test("direct circle grasp retains the projected circle center instead of using the reading pivot", () => {
  const f = make(),
    settle = advance(f);
  f.dispatch({ type: "navigate", target: "a31" });
  settle();
  const before = worldToScreen(f.hub.center, f.state.camera, f.state.viewport);
  const z = f.state.camera.z;
  f.grasp(0);
  for (const delta of [0.3, 0.8, 1.3, 2.1]) {
    f.grasp(delta);
    const center = worldToScreen(
      f.hub.center,
      f.state.camera,
      f.state.viewport,
    );
    near(center.x, before.x);
    near(center.y, before.y);
    near(f.state.camera.z, z);
  }
  f.grasp(null);
  settle();
  assert.equal(f.selected().id, "a33");
  assert.equal(f.isAnimating, false);
});

test("measured long-text windows fit on small and large screens in all directions without overlapping geometry", () => {
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 708, height: 884 },
    { width: 1366, height: 820 },
  ]) {
    const window = new Window();
    const saved = globalThis.document;
    Object.assign(globalThis, { document: window.document });
    window.document.write(
      readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
        /<script[^>]*>[\s\S]*?<\/script>/g,
        "",
      ),
    );
    const f = make(viewport.width, viewport.height),
      settle = advance(f);
    const host = window.document.querySelector("#scene")!;
    const scene = new Scene(host as unknown as HTMLElement, f.catalog);
    scene.render(f.state);
    const content = host.querySelector("#text-a0 .note-content")!;
    Object.defineProperty(content, "offsetHeight", { get: () => 1800 });
    try {
      for (const angle of [-180, -120, -90, -40, 0, 45, 90, 140, 180]) {
        f.hub.angle = f.hub.readingBearing = angle;
        f.resize(viewport);
        settle();
        scene.invalidateLayout();
        scene.render(f.state);
        f.fitReading(scene.readingBounds);
        settle();
        scene.render(f.state);
        const bounds = scene.readingBounds!;
        assert.ok(
          bounds.left >= 15 &&
            bounds.left + bounds.width <= viewport.width - 15,
        );
        assert.ok(
          bounds.top >= 75 &&
            bounds.top + bounds.height <= viewport.height - 47,
        );
        const along = nodeS(
          f.hub,
          f.hub.scroll,
          f.siblings().length,
          f.state.camera,
          viewport,
        );
        const anchor = worldToScreen(
          material(f.hub, along),
          f.state.camera,
          viewport,
        );
        const n = rot(
          outwardNormal(f.hub, along),
          (f.state.camera.rotation * Math.PI) / 180,
        );
        for (const x of [bounds.left, bounds.left + bounds.width])
          for (const y of [bounds.top, bounds.top + bounds.height])
            assert.ok(
              (x - anchor.x) * n.x + (y - anchor.y) * n.y >=
                75 * f.state.camera.z,
            );
        const max = Number(
          host.querySelector<HTMLElement>("#text-a0")!.dataset.maxFloat,
        );
        assert.ok(max > 0);
        f.dispatch({ type: "float-text", delta: 9000, maxOffset: max });
        settle();
        scene.render(f.state);
        const floatY = Number(
          /translateY\(([-\d.]+)px\)/.exec(content.getAttribute("style")!)![1],
        );
        assert.ok(
          Math.abs(floatY + max) <= 0.51,
          "the end of the long article is reachable",
        );
      }
    } finally {
      scene.destroy();
      window.close();
      Object.assign(globalThis, { document: saved });
    }
  }
});

test("direction changes remain on the shortest angular path after multiple revolutions", () => {
  for (const from of [-1800, -721, -360, 0, 540, 1080, 2150]) {
    for (const to of [-1700, -185, -90, 90, 180, 720, 1700]) {
      const result = unwrapAngle(from, to);
      assert.ok(Math.abs(result - from) <= 180);
      near(Math.cos((result * Math.PI) / 180), Math.cos((to * Math.PI) / 180));
      near(Math.sin((result * Math.PI) / 180), Math.sin((to * Math.PI) / 180));
    }
  }
});
