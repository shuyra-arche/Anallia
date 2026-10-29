import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createLoading } from "../src/effects/loading.js";

const loadOverlay = () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../dev/loading.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  return {
    window,
    overlay: window.document.querySelector("#loadingOverlay") as HTMLElement,
  };
};

test("legacy createLoading keeps a finite full lifecycle through numeric geometry", () => {
  const { window, overlay } = loadOverlay();
  let finished = 0;
  const descriptions: string[] = [];
  const loader = createLoading(
    overlay,
    () => {
      finished += 1;
    },
    (description) => descriptions.push(description),
  );
  loader.start();
  for (let i = 0; i < 250; i++) {
    loader.update(50, 1);
    for (const path of window.document.querySelectorAll("#loadingFigure path"))
      assert.doesNotMatch(path.getAttribute("d") ?? "", /NaN|Infinity/);
  }
  assert.equal(finished, 1);
  assert.ok(descriptions.length > 0);
  assert.equal(
    window.document
      .querySelector("#loadingFigure path")
      ?.getAttribute("data-loading-shape"),
    null,
  );
  window.close();
});

test("legacy exit starts from the current posture and ends within 200ms", () => {
  const { window, overlay } = loadOverlay();
  let finished = false;
  const loader = createLoading(
    overlay,
    () => {
      finished = true;
    },
    () => {},
  );
  loader.start();
  for (let i = 0; i < 40; i++) loader.update(50, 1);
  loader.exit();
  for (let i = 0; i < 3; i++) loader.update(50, 1);
  assert.equal(finished, false);
  loader.update(50, 1);
  assert.equal(finished, true);
  window.close();
});

test("legacy reduced speed freezes the looping pose instead of slowing it", () => {
  const { window, overlay } = loadOverlay();
  const loader = createLoading(
    overlay,
    () => {},
    () => {},
  );
  loader.start();
  loader.update(500, 0.25);
  const paths = [...window.document.querySelectorAll("#loadingFigure path")];
  const first = paths.map((path) => path.getAttribute("d"));
  loader.update(1000, 0.25);
  const second = paths.map((path) => path.getAttribute("d"));
  assert.deepEqual(second, first);
  assert.ok(first.some((d) => Boolean(d)));
  window.close();
});
