import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import {
  placeReading,
  readingHeight,
  readingWidth,
  resolveReadingClip,
} from "../src/core/layout.ts";
import {
  evaluatePerception,
  resolveDiscoveryStage,
} from "../src/core/perception.ts";
import { computeSoundFrame } from "../src/effects/sound.ts";
import { Scene } from "../src/rendering/scene.ts";
import { bindInput } from "../src/platform/input.ts";
import {
  material,
  nodeS,
  outwardNormal,
  worldToScreen,
  hubToScreen,
  computeHubVerticalClearance,
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

test("measured long-text windows fit on small and large screens in all directions with a single faded boundary", () => {
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
    const article = host.querySelector<HTMLElement>("#text-a0")!;
    const windowEl = article.querySelector<HTMLElement>(".note-window")!;
    const content = article.querySelector<HTMLElement>(".note-content")!;
    Object.defineProperty(content, "offsetHeight", { get: () => 1800 });
    try {
      for (const angle of [-180, -120, -90, -40, 0, 45, 90, 140, 180]) {
        f.hub.angle = f.hub.readingBearing = angle;
        f.hub.textOffset = f.hub.textOffsetTarget = 0;
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
        const hasVerticalOverlap = Math.abs(n.y) > 0.5;
        if (!hasVerticalOverlap) {
          assert.equal(article.dataset.clipEdge, "none");
          assert.equal(windowEl.dataset.clipFade, "none");
          assert.equal(windowEl.style.maskImage, "none");
        } else if (n.y < 0) {
          assert.equal(article.dataset.clipEdge, "bottom");
          assert.equal(windowEl.dataset.clipFade, "bottom");
          assert.match(windowEl.style.maskImage, /^linear-gradient\(to top/);
        } else {
          assert.equal(article.dataset.clipEdge, "none");
          assert.equal(windowEl.dataset.clipFade, "none");
          assert.equal(windowEl.style.maskImage, "none");
        }
        const max = Number(article.dataset.maxFloat);
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
        if (!hasVerticalOverlap) {
          assert.equal(article.dataset.clipEdge, "none");
          assert.equal(windowEl.dataset.clipFade, "none");
          assert.equal(windowEl.style.maskImage, "none");
        } else if (n.y > 0) {
          assert.equal(article.dataset.clipEdge, "top");
          assert.equal(windowEl.dataset.clipFade, "top");
          assert.match(
            windowEl.style.maskImage,
            /^linear-gradient\((?:to bottom,\s*)?rgba\(0,\s*0,\s*0,\s*0\)/,
          );
        } else {
          assert.equal(article.dataset.clipEdge, "none");
          assert.equal(windowEl.dataset.clipFade, "none");
          assert.equal(windowEl.style.maskImage, "none");
        }
      }
    } finally {
      scene.destroy();
      window.close();
      Object.assign(globalThis, { document: saved });
    }
  }
});

test("single truncation boundary and reading size strategy keep long lines and super-long texts balanced", () => {
  for (const w of [320, 708, 1366, 1920]) {
    const v = { width: w, height: 900 };
    assert.ok(readingWidth(v, true) <= 364);
    assert.ok(readingWidth(v, false) <= 316);
    assert.ok(readingHeight(v, 0.25, 0) <= 430);
    assert.ok(readingHeight(v, 1, 1) < readingHeight(v, 1, 0));
  }
  // When the reading column does not overlap the hub (horizontal normal or infinite clearance),
  // neither rest nor scrolling state truncates the text.
  const sideRest = resolveReadingClip({ x: 1, y: 0 }, 1600, 400, 0);
  assert.equal(sideRest.edge, "none");
  assert.equal(sideRest.fadePx, 0);
  const sideScrolled = resolveReadingClip({ x: 1, y: 0 }, 1600, 400, 240);
  assert.equal(sideScrolled.edge, "none");
  assert.equal(sideScrolled.fadePx, 0);
  assert.equal(sideScrolled.windowMarginTop, -240);
  assert.equal(sideScrolled.windowPaddingTop, 240);

  // When the hub is above (normal.y = 1), rest state has no top truncation, while scrolling into the hub clips only top
  const topRest = resolveReadingClip({ x: 0, y: 1 }, 1600, 400, 0, 16);
  assert.equal(topRest.edge, "none");
  assert.equal(topRest.fadePx, 0);
  const topClip = resolveReadingClip({ x: 0, y: 1 }, 1600, 400, 120, 16);
  assert.equal(topClip.edge, "top");
  assert.ok(topClip.fadePx > 0);
  assert.equal(topClip.windowMarginTop, -16);
  assert.equal(topClip.windowPaddingTop, 16);

  // When the hub is below (normal.y = -1), overflowing bottom clips only bottom, while scrolled-past state clears clip
  const bottomClip = resolveReadingClip({ x: 0, y: -1 }, 1600, 400, 120, 16);
  assert.equal(bottomClip.edge, "bottom");
  assert.ok(bottomClip.fadePx > 0);
  assert.equal(bottomClip.windowMarginTop, -120);
  assert.equal(bottomClip.windowPaddingTop, 120);
  assert.equal(bottomClip.windowHeight, 536);
  const bottomCleared = resolveReadingClip({ x: 0, y: -1 }, 1600, 400, 1200, 16);
  assert.equal(bottomCleared.edge, "none");
  assert.equal(bottomCleared.fadePx, 0);
});

test("manual camera rotation via Alt+wheel and two-finger touch pins the reading anchor and preserves readingBearing", () => {
  const window = new Window({ width: 1200, height: 800 });
  const keys = [
    "window",
    "document",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "AbortController",
  ] as const;
  const saved = Object.fromEntries(
    keys.map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
  );
  Object.assign(globalThis, {
    window,
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    AbortController: window.AbortController,
  });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const host = window.document.querySelector("#scene")! as unknown as HTMLElement;
  const f = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1200,
    height: 800,
  });
  const settle = advance(f);
  f.dispatch({ type: "navigate", target: "a1" });
  settle();
  const scene = new Scene(host, f.catalog);
  const dispose = bindInput(host, {
    dispatch: (command) => f.dispatch(command),
    pan: (delta, start) => f.pan(delta, start),
    zoom: (factor, point) => f.zoom(factor, point),
    rotate: (deltaDeg, point) => f.rotate(deltaDeg, point),
    camera: () => f.state.camera,
    grasp: (delta) => f.grasp(delta),
    graspGeometry: () => f.graspGeometry(),
    overview: () => f.state.overview,
    loading: () => f.state.loading,
    exitLoading: () => {},
    resolve: (key) => scene.actions.get(key),
  });
  try {
    const readingAnchorScreen = () => {
      const along = nodeS(
        f.hub,
        f.hub.scroll,
        f.siblings().length,
        f.state.camera,
        f.state.viewport,
      );
      return hubToScreen(
        f.hub,
        material(f.hub, along, 76),
        f.state.camera,
        f.state.viewport,
      );
    };
    const anchorBefore = readingAnchorScreen();
    const rotBefore = f.state.camera.rotation;
    const zBefore = f.state.camera.z;
    const wheelEvent = new window.WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      altKey: true,
      deltaY: 250,
    });
    Object.defineProperty(wheelEvent, "altKey", {
      value: true,
      configurable: true,
    });
    host.dispatchEvent(wheelEvent);
    const anchorAfter = readingAnchorScreen();
    near(anchorAfter.x, anchorBefore.x);
    near(anchorAfter.y, anchorBefore.y);
    near(f.state.camera.z, zBefore);
    near(f.state.camera.rotation, rotBefore + 30);
    const manualBearing = f.hub.readingBearing!;
    // Stepping to the next chapter in circle mode preserves the manually rotated bearing
    f.dispatch({ type: "step", delta: 1 });
    settle();
    assert.equal(f.selected().id, "a2");
    near(f.hub.readingBearing!, manualBearing);

    // Two-finger pinch + twist simultaneously zooms and rotates around midpoint
    const rotBeforeTouch = f.state.camera.rotation;
    const zBeforeTouch = f.state.camera.z;
    host.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
        clientX: 400,
        clientY: 400,
      }),
    );
    host.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 2,
        pointerType: "touch",
        clientX: 600,
        clientY: 400,
      }),
    );
    window.dispatchEvent(
      new window.PointerEvent("pointermove", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 400,
        clientY: 600,
      }),
    );
    window.dispatchEvent(
      new window.PointerEvent("pointerup", {
        pointerId: 1,
        pointerType: "touch",
      }),
    );
    window.dispatchEvent(
      new window.PointerEvent("pointerup", {
        pointerId: 2,
        pointerType: "touch",
      }),
    );
    near(f.state.camera.rotation, rotBeforeTouch + 90);
    near(f.state.camera.z, zBeforeTouch);
  } finally {
    dispose();
    scene.destroy();
    window.close();
    Object.assign(globalThis, saved);
  }
});

test("relational perception hierarchy, progressive onboarding stages, and geometric soundscape remain consistent", () => {
  const f = make(),
    settle = advance(f);
  // 1. At initial arrival on a0, stage is "threshold" and linked hubs (B, D, M, S) have higher weight than unrelated hubs (C, E, L, Q)
  assert.equal(resolveDiscoveryStage(f.state), "threshold");
  const p0 = evaluatePerception(f.state, f.catalog);
  assert.equal(p0.hubs.A.tier, "focused");
  assert.equal(p0.hubs.B.tier, "related");
  assert.equal(p0.hubs.D.tier, "related");
  assert.equal(p0.hubs.L.tier, "ambient");
  assert.ok(p0.hubs.B.curveOpacity > p0.hubs.L.curveOpacity);

  // 2. Hovering a reference target elevates its destination hub to "resonating"
  const pHover = evaluatePerception(f.state, f.catalog, "b0");
  assert.equal(pHover.resonatingHubId, "B");
  assert.equal(pHover.hubs.B.tier, "resonating");
  assert.ok(pHover.hubs.B.curveOpacity > p0.hubs.B.curveOpacity);

  // 3. Morphing a0 advances discovery stage from "threshold" to "orienting" and continuously shifts sound timbre
  const soundCircle = computeSoundFrame(f.state);
  f.dispatch({ type: "morph" });
  settle();
  assert.equal(resolveDiscoveryStage(f.state), "orienting");
  const soundLine = computeSoundFrame(f.state);
  near(soundCircle.morphRatio, 1.0);
  near(soundLine.morphRatio, 1.5);
  assert.ok(soundLine.filterCutoffHz > soundCircle.filterCutoffHz * 3);
  assert.ok(soundCircle.continuousGain <= 0.015);
  assert.ok(soundLine.harmonicMix > soundCircle.harmonicMix);

  // 4. Navigating across hubs advances discovery stage to "immersed" and toggle_sound mutes cleanly
  f.dispatch({ type: "navigate", target: "b0" });
  settle();
  assert.equal(resolveDiscoveryStage(f.state), "immersed");
  f.dispatch({ type: "navigate", target: "act:toggle_sound" });
  assert.equal(f.state.settings.sound, false);
  assert.equal(computeSoundFrame(f.state, 1, 1).continuousGain, 0);
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

test("shallow line angles clip long text before it crosses the hub", () => {
  const f = make();
  const hub = f.state.hubs.B;
  hub.morph = 1;
  hub.fold = 0;
  for (const angle of [-170, -10, 10, 170]) {
    hub.angle = angle;
    for (const z of [0.18, 1, 2.4]) {
      const camera = { x: 0, y: 0, rotation: 0, z };
      const normal = outwardNormal(hub, 0);
      const anchor = hubToScreen(hub, material(hub, 0, 76), camera, f.state.viewport);
      const curve = hubToScreen(hub, material(hub, 0), camera, f.state.viewport);
      const placement = placeReading(anchor, normal, 316, 400, z);
      const clearance = computeHubVerticalClearance(
        hub, placement, 316, 400, normal, camera, f.state.viewport,
      );
      assert.ok(Number.isFinite(clearance));
      const offset = normal.y > 0 ? 1200 : 0;
      const clip = resolveReadingClip(normal, 2000, 400, offset, clearance);
      assert.equal(clip.edge, normal.y > 0 ? "top" : "bottom");
      const top = placement.top + clip.windowMarginTop * z;
      const bottom = top + clip.windowHeight * z;
      for (const x of [placement.left, placement.left + 316 * z]) {
        for (const y of [top, bottom]) {
          const distance = ((x - curve.x) * normal.x + (y - curve.y) * normal.y) / z;
          assert.ok(distance >= 56 - 1e-6, `text overlaps hub at ${angle} degrees`);
        }
      }
      assert.notEqual(resolveReadingClip(normal, 2000, 400, offset).edge, "none");
    }
  }
  hub.angle = 0;
  const normal = outwardNormal(hub, 0);
  const camera = { x: 0, y: 0, rotation: 0, z: 1 };
  const anchor = hubToScreen(hub, material(hub, 0, 76), camera, f.state.viewport);
  const placement = placeReading(anchor, normal, 316, 400);
  assert.equal(computeHubVerticalClearance(
    hub, placement, 316, 400, normal, camera, f.state.viewport,
  ), Infinity);
});
