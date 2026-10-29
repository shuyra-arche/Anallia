import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { RenderProfiler } from "../src/core/render-profile.ts";
import type { RenderSample } from "../src/core/render-profile.ts";
import { summarizeRenderProfiles } from "./helpers/render-profile.ts";
import { Scene } from "../src/rendering/scene.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";

test("render stages are exclusive, accumulate repeated boundaries and retain frame snapshots", () => {
  let time = 0;
  const samples: RenderSample[] = [];
  const probe = new RenderProfiler(sample => samples.push(sample), () => time);
  probe.begin(); time = 2; probe.mark("scene.host");
  time = 5; probe.mark("scene.reading");
  time = 7; probe.mark("scene.host");
  probe.finish("svg", "full");
  assert.equal(samples[0].total, 7);
  assert.deepEqual(samples[0].stages, { "scene.host": 4, "scene.reading": 3 });
  probe.begin(); time = 8; probe.mark("gpu.submit"); probe.finish("webgl", "cached");
  assert.equal(samples[1].total, 1);
  assert.deepEqual(samples[0].stages, { "scene.host": 4, "scene.reading": 3 });
  assert.deepEqual(samples[1].stages, { "gpu.submit": 1 });
});

test("profile summaries separate cache paths and compute contribution from frame totals", () => {
  const summary = summarizeRenderProfiles([
    { renderer: "svg", path: "full", total: 8, stages: { "scene.geometry": 2, "scene.reading": 6 } },
    { renderer: "svg", path: "cached", total: 2, stages: { "svg.render": 2 } },
  ]);
  assert.equal(summary.totalP95, 8);
  assert.equal(summary.full.samples, 1);
  assert.equal(summary.cached.samples, 1);
  assert.equal(summary.stages["scene.reading"].sharePercent, 60);
  assert.equal(summary.stages["scene.geometry"].p95, 2);
  assert.equal(summary.slowFrames[0].total, 8);
  assert.equal(summarizeRenderProfiles([]).totalP95, 0);
});

test("scene profiles full and cached SVG frames only while enabled, then releases the sink", () => {
  const window = new Window();
  const saved = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  window.document.write(readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script[^>]*>[\s\S]*?<\/script>/g, ""));
  const host = window.document.querySelector("#scene") as unknown as HTMLElement;
  const field = new Field(new Catalog(hubDefinitions, rawContent), { width: 1366, height: 820 });
  field.state.settings.background = "none";
  const scene = new Scene(host, field.catalog, { renderer: "svg" });
  const samples: RenderSample[] = [];
  let ticks = 0;
  try {
    scene.setRenderProfiler(sample => samples.push(sample), () => ++ticks);
    scene.render(field.state);
    scene.render(field.state);
    assert.equal(samples[0].path, "full");
    assert.equal(samples[1].path, "cached");
    assert.equal(samples[0].stages["scene.reading"], 1);
    assert.equal(samples[1].stages["scene.reading"], undefined);
    assert.equal(samples[0].stages["scene.geometry"], 1);
    for (const sample of samples) assert.equal(Object.values(sample.stages).reduce((sum, ms) => sum + ms!, 0), sample.total);
    scene.setRenderProfiler(null);
    const before = ticks;
    field.state.camera.x++;
    scene.render(field.state);
    assert.equal(ticks, before);
    assert.equal(samples.length, 2);
    scene.destroy();
    scene.setRenderProfiler(sample => samples.push(sample), () => ++ticks);
    scene.render(field.state);
    assert.equal(ticks, before);
  } finally {
    scene.destroy();
    window.close();
    Object.assign(globalThis, { document: saved });
  }
});
