import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { Scene } from "../src/rendering/scene.ts";
import { Ambient } from "../src/effects/ambient.ts";
import { hubToScreen, material, nodeS } from "../src/geometry/field.ts";
import { readingWidth } from "../src/core/layout.ts";

const fresh = () =>
  new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1200,
    height: 800,
  });
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const hinge = (f: Field) =>
  hubToScreen(
    f.hub,
    material(
      f.hub,
      nodeS(
        f.hub,
        f.hub.scroll,
        f.siblings().length,
        f.state.camera,
        f.state.viewport,
      ),
    ),
    f.state.camera,
    f.state.viewport,
  );

test("zoom at a hub hinge holds the hinge while scaling its local geometry", () => {
  for (const morph of [0, 0.38, 1]) {
    const f = fresh();
    f.hub.morph = f.hub.targetMorph = morph;
    f.state.camera.z = 0.6;
    const anchor = hinge(f);
    const world = material(f.hub, 45, 52);
    const before = hubToScreen(f.hub, world, f.state.camera, f.state.viewport);
    f.zoom(1.8, anchor);
    const after = hubToScreen(f.hub, world, f.state.camera, f.state.viewport);
    close(hinge(f).x, anchor.x);
    close(hinge(f).y, anchor.y);
    close(after.x - anchor.x, (before.x - anchor.x) * 1.8);
    close(after.y - anchor.y, (before.y - anchor.y) * 1.8);
  }
});

test("forward and reverse morph keep the material hinge pinned at every zoom", () => {
  for (const z of [0.18, 0.5, 1, 2.4]) {
    const f = fresh();
    f.state.camera.z = z;
    const anchor = hinge(f);
    for (const start of [0, 1000]) {
      f.dispatch({ type: "morph" });
      for (let t = start; t <= start + 1000; t += 20) {
        f.update(t, 20);
        close(hinge(f).x, anchor.x);
        close(hinge(f).y, anchor.y);
        close(f.state.camera.z, z);
      }
    }
  }
});

test("zoom preserves reading layout and text offset while scaling labels and article around their hinge", () => {
  const window = new Window();
  const saved = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const host = window.document.querySelector("#scene")!;
  const f = fresh();
  const scene = new Scene(host as unknown as HTMLElement, f.catalog);
  try {
    f.hub.textOffset = f.hub.textOffsetTarget = 40;
    let width = "";
    for (const z of [0.4, 0.8, 1.6]) {
      f.state.camera.z = z;
      scene.render(f.state);
      const article = host.querySelector<HTMLElement>("#text-a0")!;
      if (width)
        assert.equal(
          article.style.width,
          width,
          "zoom scales typography without reflowing paragraphs",
        );
      width = article.style.width;
      assert.match(article.style.transform, new RegExp(`scale\\(${z}\\)`));
      const label = host.querySelector('[data-command="A:a0"]')!;
      assert.match(
        label.getAttribute("transform")!,
        new RegExp(`scale\\(${z}\\)`),
      );
      close(f.hub.textOffset, 40);
      const anchorY = Number.parseFloat(
        article.style.transformOrigin.split(" ")[1],
      );
      const translation = /translate3d\(([^,]+)px,([^,]+)px,0\)/.exec(
        article.style.transform,
      )!;
      const articleAnchor = hubToScreen(
        f.hub,
        material(f.hub, 0, 76),
        f.state.camera,
        f.state.viewport,
      );
      assert.ok(Math.abs(Number(translation[1]) - articleAnchor.x) < 0.01);
      assert.ok(
        Math.abs(Number(translation[2]) + anchorY - articleAnchor.y) < 0.02,
      );
      assert.equal(host.style.getPropertyValue("--camera-scale"), String(z));
    }
  } finally {
    scene.destroy();
    window.close();
    Object.assign(globalThis, { document: saved });
  }
});

test("background paths, line widths and markers scale with the camera without resampling", () => {
  const window = new Window();
  const saved = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  const group = window.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  const ambient = new Ambient(group as unknown as SVGGElement);
  const camera = { x: 0, y: 0, z: 0.5, rotation: 0 };
  const viewport = { width: 1200, height: 800 };
  try {
    ambient.render(camera, viewport, 1000, [], false, false);
    const path = group.querySelector(".flow-line")!;
    const coordinates = (d: string) =>
      [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const before = coordinates(path.getAttribute("d")!);
    camera.z = 1;
    ambient.render(camera, viewport, 1000, [], false, false);
    const after = coordinates(path.getAttribute("d")!);
    assert.equal(before.length, after.length);
    after.forEach((n, i) =>
      assert.ok(
        Math.abs(
          n -
            (i % 2 === 0 ? 600 : 400) -
            2 * (before[i] - (i % 2 === 0 ? 600 : 400)),
        ) < 0.02,
      ),
    );
    close(Number(path.getAttribute("stroke-width")), 1.05);
    close(Number(group.querySelector(".flow-marker")!.getAttribute("r")), 1.7);
  } finally {
    window.close();
    Object.assign(globalThis, { document: saved });
  }
});

test("entering any hub restores a readable scale and fits the reading column after extreme zoom", () => {
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 708, height: 884 },
    { width: 1366, height: 820 },
    { width: 1896, height: 1016 },
  ]) {
    const f = new Field(
      new Catalog(hubDefinitions, rawContent),
      viewport,
      true,
    );
    let now = 0;
    const settle = () => {
      for (let i = 0; i < 5; i++) f.update((now += 20), 20);
    };
    const check = () => {
      assert.ok(f.state.camera.z >= 1.1 && f.state.camera.z <= 1.15);
      const hub = f.hub;
      const parameter = nodeS(
        hub,
        hub.scroll,
        f.siblings().length,
        f.state.camera,
        viewport,
      );
      const article = hubToScreen(
        hub,
        material(hub, parameter, 76),
        f.state.camera,
        viewport,
      );
      assert.ok(
        article.x >= 15,
        `${hub.id}: reading column begins inside viewport`,
      );
      assert.ok(
        article.x + readingWidth(viewport, true) * f.state.camera.z <=
          viewport.width - 15,
        `${hub.id}: reading column fits at readable scale`,
      );
      const top = article.y - 58 * f.state.camera.z;
      assert.ok(
        top >= 60 && top <= 181,
        `${hub.id}: article starts above the viewport midpoint`,
      );
    };
    check();
    for (const hub of hubDefinitions) {
      for (const zoom of [0.18, 2.4]) {
        f.state.camera.z = zoom;
        f.dispatch({ type: "focus", hub: hub.id });
        settle();
        assert.equal(f.state.focus, hub.id);
        check();
      }
    }
    f.dispatch({ type: "overview" });
    settle();
    f.dispatch({ type: "navigate", target: "b0" });
    settle();
    assert.equal(f.state.overview, false);
    check();
  }
});
