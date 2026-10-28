import test from "node:test";
import assert from "node:assert/strict";
import {
  LoadingPresenter,
  geometryForSnapshot,
} from "../src/application/loading.ts";
import type { LoadingGeometry } from "../src/geometry/loading.ts";
import { LOADING_EXIT_MS } from "../src/core/loading.ts";

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
