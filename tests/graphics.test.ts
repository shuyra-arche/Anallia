import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { Scene } from "../src/rendering/scene.ts";
import {
  clipToSvgPath,
  curveToSvgPath,
  evaluateFilament,
  evaluateHubAuraCurve,
  evaluateHubCurve,
  evaluateHubCurveClip,
  evaluatePassageGeometry,
  parseSvgPathData,
} from "../src/geometry/graphics.ts";
import { evaluateBackgroundFrame, GpuBackgroundAdapter } from "../src/rendering/graphics/background.ts";
import { GpuGlyphCache, IconGeometryCache } from "../src/rendering/graphics/glyph-cache.ts";
import { ICON_TOKENS } from "../src/core/icons.ts";
import { evaluateSymbol } from "../src/core/symbol-morph.ts";
import { emptySceneFrame, hitTestFrame } from "../src/core/graphics.ts";

const finite = (n: number) => Number.isFinite(n);

function dom() {
  const window = new Window();
  const saved = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  return {
    window,
    host: window.document.querySelector("#scene") as unknown as HTMLElement,
    close() {
      window.close();
      Object.assign(globalThis, { document: saved });
    },
  };
}

test("hub geometry is extracted as exact circles or finite point lists without path parsing", () => {
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1366,
    height: 820,
  });
  const circle = evaluateHubCurve(field.hub, field.state.camera, {
    width: 1366,
    height: 820,
  });
  assert.equal(circle.kind, "circle");
  assert.ok(circle.kind === "circle" && finite(circle.radius) && circle.radius > 0);
  assert.match(curveToSvgPath(circle), /^M/);

  field.hub.morph = field.hub.targetMorph = 1;
  const line = evaluateHubCurve(field.hub, field.state.camera, {
    width: 1366,
    height: 820,
  });
  assert.equal(line.kind, "polyline");
  if (line.kind === "polyline") {
    assert.ok(line.points.length > 8);
    for (const point of line.points)
      assert.ok(finite(point.x) && finite(point.y));
  }
  const clip = evaluateHubCurveClip(field.hub, field.state.camera, {
    width: 1366,
    height: 820,
  });
  assert.ok(clip.curve.kind === "polyline");
  assert.doesNotMatch(clipToSvgPath(clip), /NaN|Infinity|undefined/);
  const aura = evaluateHubAuraCurve(
    field.hub,
    field.state.camera,
    { width: 1366, height: 820 },
    15,
  );
  assert.equal(aura.kind, "polyline");

  const filament = evaluateFilament({ x: 10, y: 20 }, { x: 300, y: 80 });
  assert.ok(filament.length > 2);
});

test("SceneFrame carries layers, labels, masks, reading placement and CPU hit regions", async () => {
  const d = dom();
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1896,
    height: 1016,
  });
  const scene = new Scene(d.host, field.catalog, { renderer: "svg" });
  try {
    await scene.initialize();
    assert.equal(scene.rendererKind, "svg");
    scene.render(field.state);
    const frame = scene.frame;
    assert.deepEqual(
      frame.layers.map((layer) => layer.id),
      ["base", "portal", "background", "hubs", "relations", "labels", "reading"],
    );
    assert.ok(frame.labels.length > 0);
    assert.ok(frame.reading.length > 0);
    assert.ok(frame.hitRegions.length >= frame.labels.length);
    assert.equal(frame.background?.mode, "flow");
    assert.equal(frame.background?.streamlines.length, 35);
    assert.equal(
      d.host.querySelectorAll(".svg-graphics .flow-line").length,
      35,
      "SVG fallback draws the same numeric background batch",
    );
    assert.equal(d.host.querySelector("#gDecorations")!.childElementCount, 0,
      "the legacy background does not duplicate the numeric renderer");
    assert.equal(
      d.host.querySelector('#hudControls [data-command="hud:loading"]'),
      null,
    );
    const hubPath = d.host
      .querySelector('[data-hub-id="A"].curve')!
      .getAttribute("d");
    assert.equal(
      hubPath,
      curveToSvgPath(
        evaluateHubCurve(
          field.state.hubs.A,
          field.state.camera,
          field.state.viewport,
        ),
      ),
      "SVG hub stroke is serialized from the same numeric frame geometry",
    );

    const label = frame.labels.find((entry) => entry.id === "A:a0")!;
    const hit = scene.hitTest(label.layout.position);
    assert.equal(hit?.command.type, "morph");
    assert.equal(hit?.chapterId, "a0");
    assert.equal(hit?.graspKind, "label");
    assert.equal(hitTestFrame(frame, { x: -1e6, y: -1e6 }), null);

    field.state.settings.background = "stars";
    scene.render(field.state);
    assert.equal(scene.frame.background?.mode, "stars");
    assert.equal(scene.frame.background?.trails.length, 72);
    assert.equal(
      d.host.querySelectorAll(".svg-graphics .star-trail").length,
      72,
    );
    assert.equal(
      d.host.querySelector(".svg-graphics .background-flow")!.getAttribute("display"),
      "none",
    );
    field.state.settings.background = "none";
    scene.render(field.state);
    assert.equal(scene.frame.background?.mode, "none");
    for (const selector of [".background-flow", ".background-stars"]) {
      assert.equal(d.host.querySelector(`.svg-graphics ${selector}`)!.getAttribute("display"), "none");
    }
  } finally {
    scene.destroy();
    d.close();
  }
});

test("Scene falls back permanently to SVG when WebGL cannot initialize and keeps state", async () => {
  const d = dom();
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1000,
    height: 700,
  });
  const scene = new Scene(d.host, field.catalog, { renderer: "webgl" });
  try {
    await scene.initialize();
    assert.equal(scene.rendererKind, "svg");
    assert.equal(d.host.dataset.renderer, "svg");
    scene.render(field.state);
    await scene.initialize();
    assert.equal(scene.rendererKind, "svg");
    assert.ok(scene.frame.labels.length > 0);
  } finally {
    scene.destroy();
    d.close();
  }
});

test("numeric background batches 35 streamlines and star trails without SVG input", () => {
  const camera = { x: 12, y: 34, z: 0.8, rotation: 12 };
  const viewport = { width: 1280, height: 800 };
  const flow = evaluateBackgroundFrame({
    mode: "flow",
    camera,
    viewport,
    elapsed: 1200,
    theme: "dark",
    overview: true,
    impulses: [{ center: { x: 0, y: 0 }, started: 1000, maxRadius: 800 }],
  });
  assert.equal(flow.streamlines.length, 35);
  assert.ok(flow.streamlines.every((line) => line.points.length > 0));
  const stars = evaluateBackgroundFrame({
    mode: "stars",
    camera,
    viewport,
    elapsed: 7200,
    theme: "dark",
  });
  assert.equal(stars.trails.length, 72);
  assert.ok(stars.stars.length > 0);
  assert.ok(stars.stars.length <= 384);
  assert.ok(
    [...stars.stars, ...stars.trails].every((entry) =>
      "at" in entry
        ? finite(entry.at.x) && finite(entry.at.y)
        : finite(entry.center.x) && finite(entry.center.y),
    ),
  );
  const adapter = new GpuBackgroundAdapter();
  assert.equal(
    adapter.render("flow", camera, viewport, 0, [], true, false, "dark", false)
      .streamlines.length,
    35,
  );
});

test("glyph cache invalidates on theme, DPR and font changes and caches icon geometry", () => {
  const cache = new GpuGlyphCache<number>();
  let created = 0;
  cache.setEnvironment({ theme: "light", dpr: 1, fontFamily: "A" });
  cache.getOrCreate("label", () => ++created);
  cache.getOrCreate("label", () => ++created);
  assert.equal(created, 1);
  assert.equal(cache.size, 1);
  assert.equal(
    cache.setEnvironment({ theme: "dark", dpr: 1, fontFamily: "A" }),
    true,
  );
  assert.equal(cache.size, 0);
  cache.getOrCreate("label", () => ++created);
  cache.setEnvironment({ theme: "dark", dpr: 2, fontFamily: "A" });
  cache.setEnvironment({ theme: "dark", dpr: 2, fontFamily: "B" });
  assert.equal(cache.invalidationCount, 3);

  const icons = new IconGeometryCache();
  const token = ICON_TOKENS["⚙"];
  const parsed = icons.getIcon(token);
  assert.ok(parsed.length > 0);
  assert.ok(parsed.every((line) => line.length > 1));
  assert.equal(icons.getIcon(token), parsed);
  const symbol = evaluateSymbol("overview", 0.5, 0.2);
  assert.ok(icons.getSymbol(symbol).length > 0);
  assert.doesNotThrow(() => parseSvgPathData(token.shapes[0].attrs.d as string));
});

test("color-sweep passage publishes the same numeric portal mask and stroke used by SVG", () => {
  const d = dom();
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1366,
    height: 820,
  });
  const scene = new Scene(d.host, field.catalog, { renderer: "svg" });
  try {
    field.dispatch({ type: "navigate", target: "d0" });
    scene.render(field.state);
    const portal = scene.frame.portal;
    assert.ok(portal?.visible);
    const mask = scene.frame.masks.find((entry) => entry.id === portal.maskId);
    assert.ok(mask);
    assert.ok(mask.shapes.length > 0);
    const geometry = evaluatePassageGeometry(
      field.state.passage!,
      field.state.camera,
      field.state.viewport,
    );
    assert.equal(
      d.host.querySelector("#portalBoundaryPath")!.getAttribute("d"),
      clipToSvgPath(geometry.boundary),
    );
    assert.equal(
      d.host.querySelector("#portalStroke")!.getAttribute("d"),
      curveToSvgPath(geometry.stroke),
    );
  } finally {
    scene.destroy();
    d.close();
  }
});

test("portal geometry stays finite for near, remote and axis passages", () => {
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1366,
    height: 820,
  });
  const camera = field.state.camera;
  const viewport = field.state.viewport;
  const anchor = {
    center: { x: 0, y: 0 },
    angle: 0,
    morph: 0,
  };
  for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
    const geometry = evaluatePassageGeometry(
      {
        kind: "remote",
        direction: "forward",
        from: anchor,
        to: { center: { x: 4000, y: 0 }, angle: 120, morph: 0 },
        sourceTheme: "light",
        source: "a0",
        target: "b0",
        theme: "dark",
        started: 0,
        duration: 1000,
        phase,
        commit: () => {},
        committed: false,
      },
      camera,
      viewport,
    );
    assert.doesNotMatch(
      clipToSvgPath(geometry.boundary),
      /NaN|Infinity|undefined/,
    );
    assert.doesNotMatch(curveToSvgPath(geometry.stroke), /NaN|Infinity/);
  }
});

test("dynamic symbol geometry reaches the GPU cache without reading SVG path strings", () => {
  const geometry = evaluateSymbol("overview", 0.418, 0.62);
  for (const path of geometry.paths) Object.defineProperty(path, "d", { get() { throw new Error("SVG serialization must stay in SVG rendering"); } });
  const cache = new IconGeometryCache();
  const points = cache.getSymbol(geometry);
  assert.equal(points.length, geometry.paths.length);
  assert.deepEqual(points, geometry.paths.map(path => path.points));
});

test("circular hub hits use the original scaled stroke band and leave the interior free for panning", () => {
  const frame = { hitRegions: [{ id: "hub:A", command: { type: "morph" as const }, priority: 10, shape: { type: "circle" as const, x: 100, y: 100, radius: 80, strokeWidth: 32 } }] };
  assert.equal(hitTestFrame(frame, { x: 100, y: 100 }), null);
  assert.equal(hitTestFrame(frame, { x: 180, y: 100 })?.id, "hub:A");
  assert.equal(hitTestFrame(frame, { x: 195, y: 100 })?.id, "hub:A");
  assert.equal(hitTestFrame(frame, { x: 197, y: 100 }), null);
});


test("a committed scene frame does not retain mutable camera or viewport objects", () => {
  const camera = { x: 10, y: 20, z: 1.2, rotation: 30 };
  const viewport = { width: 800, height: 600 };
  const frame = emptySceneFrame("svg", viewport, camera, "light");
  camera.x = 300; camera.z = 4; viewport.width = 1200;
  assert.deepEqual(frame.camera, { x: 10, y: 20, z: 1.2, rotation: 30 });
  assert.deepEqual(frame.viewport, { width: 800, height: 600 });
});
