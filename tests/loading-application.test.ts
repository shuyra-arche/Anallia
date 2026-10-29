import test from "node:test";
import assert from "node:assert/strict";
import {
  LoadingPresenter,
  geometryForSnapshot,
} from "../src/application/loading.ts";
import type { LoadingGeometry } from "../src/geometry/loading.ts";
import { TaskGeometry } from "../src/application/task-geometry.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import { LOADING_EXIT_MS, LoadController } from "../src/core/loading.ts";

test("presenter binds a real task to scene-supplied placement and clears when empty", () => {
  const rendered: LoadingGeometry[] = [];
  let clears = 0;
  const presenter = new LoadingPresenter(
    {
      render: (geometry) => rendered.push(geometry),
      clear: () => {
        clears += 1;
      },
    },
    () => ({
      anchor: { x: 320, y: 180 },
      angle: 0.35,
      scale: 1.2,
      theme: "rosewood",
    }),
  );

  assert.equal(
    presenter.start(
      {
        id: "chapter",
        scope: "hub",
        hubId: "hub:a",
        cancellable: true,
      },
      1000,
    ),
    null,
  );
  assert.equal(clears, 1);
  assert.equal(presenter.update(1100, false), null);
  assert.equal(rendered.length, 0);

  const shown = presenter.update(1200, false);
  assert.ok(shown);
  assert.equal(rendered.length, 1);
  assert.deepEqual(rendered[0].placement.anchor, { x: 320, y: 180 });
  assert.equal(rendered[0].theme, "rosewood");
  assert.equal(rendered[0].placement.scale, 1.2);
  assert.deepEqual(
    rendered[0],
    geometryForSnapshot(shown, {
      anchor: { x: 320, y: 180 },
      angle: 0.35,
      scale: 1.2,
      theme: "rosewood",
    }),
  );

  const streaming = presenter.readable("chapter", 1300);
  assert.ok(streaming);
  assert.equal(rendered.at(-1)?.opacity, 1);
  const completed = presenter.complete("chapter", 1400);
  assert.ok(completed);
  assert.equal(rendered.at(-1)?.phase, "leaving");

  assert.equal(presenter.update(1400 + LOADING_EXIT_MS, false), null);
  assert.equal(clears, 3);
  assert.equal(presenter.update(2000, false), null);
  assert.equal(clears, 4);
});

test("loading placement easing uses only the host frame delta after a hidden interval", () => {
  const catalog = new Catalog(hubDefinitions, rawContent), field = new Field(catalog, { width: 1366, height: 820 });
  const controller = new LoadController(), geometry = new TaskGeometry();
  controller.start({ id: "task", scope: "navigation", hubId: "A", chapterId: "a0", cancellable: true }, 0);
  const first = geometry.update(controller.update(250), field.state, catalog, 0)!;
  controller.shiftVisualTime(60000);
  const readable = controller.readable("task", 60250);
  const resumed = geometry.update(readable, field.state, catalog, 0)!;
  assert.equal(resumed.placement.scale, first.placement.scale);
  const advanced = geometry.update(readable, field.state, catalog, 16)!;
  assert.ok(advanced.placement.scale < first.placement.scale);
  assert.ok(advanced.placement.scale > .18 * field.state.camera.z);
});
