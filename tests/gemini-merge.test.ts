import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { Scene } from "../src/rendering/scene.ts";
import { bindInput } from "../src/platform/input.ts";
import type { Command } from "../src/core/types.ts";
const create = (
  reduced = false,
  catalog = new Catalog(hubDefinitions, rawContent),
) => new Field(catalog, { width: 390, height: 844 }, reduced);
const advance = (field: Field) => {
  let now = 0;
  return () => {
    for (let i = 0; i < 100; i++) {
      now += 20;
      field.update(now, 20);
    }
  };
};
test("search input cannot interrupt navigation or mutate another active hub", () => {
  const field = create(),
    settle = advance(field);
  field.dispatch({ type: "navigate", target: "q0" });
  const passage = field.state.passage;
  field.dispatch({ type: "search", query: "流场" });
  assert.equal(field.state.searchQuery, "");
  assert.equal(field.state.passage, passage);
  settle();
  field.dispatch({ type: "search", query: "流场" });
  assert.equal(field.state.searchQuery, "流场");
  field.dispatch({ type: "navigate", target: "a0" });
  settle();
  const camera = { ...field.state.camera };
  field.dispatch({ type: "search", query: "长文" });
  assert.equal(field.state.searchQuery, "流场");
  assert.deepEqual(field.state.camera, camera);
});
test("search queries and virtual result selection are restored together through history", () => {
  const field = create(),
    settle = advance(field);
  field.dispatch({ type: "navigate", target: "q0" });
  settle();
  field.dispatch({ type: "search", query: "流场" });
  const first = field.state.searchResults[0];
  assert.ok(first);
  field.dispatch({ type: "navigate", target: first });
  settle();
  field.dispatch({ type: "navigate", target: "a0" });
  settle();
  field.dispatch({ type: "navigate", target: "q0" });
  settle();
  field.dispatch({ type: "search", query: "长文" });
  field.dispatch({ type: "back" });
  settle();
  field.dispatch({ type: "back" });
  settle();
  assert.equal(field.selected().id, first);
  assert.equal(field.state.searchQuery, "流场");
  assert.ok(field.siblings().some((node) => node.id === first));
});
test("two reading sessions share a catalog without sharing mutable search results", () => {
  const catalog = new Catalog(hubDefinitions, rawContent),
    a = create(false, catalog),
    b = create(false, catalog),
    settleA = advance(a),
    settleB = advance(b);
  a.dispatch({ type: "navigate", target: "q0" });
  b.dispatch({ type: "navigate", target: "q0" });
  settleA();
  settleB();
  a.dispatch({ type: "search", query: "流场" });
  const ids = a.siblings().map((node) => node.id);
  b.dispatch({ type: "search", query: "长文" });
  assert.deepEqual(
    a.siblings().map((node) => node.id),
    ids,
  );
  assert.notDeepEqual(a.state.searchResults, b.state.searchResults);
});
test("reset defaults respects the current system reduced-motion preference", () => {
  const field = create(true);
  field.dispatch({ type: "navigate", target: "act:toggle_motion" });
  assert.equal(field.state.settings.reducedMotion, false);
  field.dispatch({ type: "navigate", target: "act:reset_defaults" });
  assert.equal(field.state.settings.reducedMotion, true);
  field.setSystemReducedMotion(false);
  field.dispatch({ type: "navigate", target: "act:toggle_motion" });
  field.dispatch({ type: "navigate", target: "act:reset_defaults" });
  assert.equal(field.state.settings.reducedMotion, false);
});
function setupDOM() {
  const window = new Window({ width: 390, height: 844 });
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
  return {
    window,
    host: window.document.querySelector("#scene")! as unknown as HTMLElement,
    close: () => {
      window.close();
      Object.assign(globalThis, saved);
    },
  };
}
test("Chinese composition commits once and search rerenders preserve input focus and caret", () => {
  const dom = setupDOM(),
    field = create(),
    settle = advance(field);
  field.dispatch({ type: "navigate", target: "q0" });
  settle();
  const scene = new Scene(dom.host, field.catalog);
  scene.render(field.state);
  const dispatched: string[] = [],
    dispose = bindInput(dom.host, {
      dispatch: (command) => {
        dispatched.push(command.type);
        field.dispatch(command);
      },
      pan: (delta, start) => field.pan(delta, start),
      zoom: (factor, point) => field.zoom(factor, point),
      camera: () => field.state.camera,
      grasp: (delta) => field.grasp(delta),
      graspGeometry: () => field.graspGeometry(),
      overview: () => field.state.overview,
      loading: () => field.state.loading,
      exitLoading: () => {},
      resolve: (key) => scene.actions.get(key),
    });
  try {
    const input =
      dom.host.querySelector<HTMLInputElement>(".hub-search-input")!;
    input.focus();
    input.dispatchEvent(
      new dom.window.CompositionEvent("compositionstart", { bubbles: true }),
    );
    input.value = "流";
    input.dispatchEvent(
      new dom.window.InputEvent("input", { bubbles: true, isComposing: true }),
    );
    assert.equal(dispatched.length, 0);
    input.value = "流场";
    input.setSelectionRange(1, 1);
    input.dispatchEvent(
      new dom.window.CompositionEvent("compositionend", { bubbles: true }),
    );
    input.dispatchEvent(
      new dom.window.InputEvent("input", { bubbles: true, isComposing: false }),
    );
    assert.deepEqual(dispatched, ["search"]);
    scene.render(field.state);
    assert.equal(dom.host.querySelector(".hub-search-input"), input);
    assert.equal(dom.window.document.activeElement, input);
    assert.equal(input.selectionStart, 1);
    assert.equal(field.selected().id, "q0");
    const result = field.state.searchResults[0];
    assert.ok(result);
    assert.deepEqual(scene.actions.get(`Q:${result}`), {
      type: "navigate",
      target: result,
    });
  } finally {
    dispose();
    scene.destroy();
    dom.close();
  }
});
test("long-article wheel floats text without moving the camera or blocking text selection", () => {
  const dom = setupDOM(),
    article = dom.window.document.createElement("article");
  article.className = "note is-long";
  article.dataset.maxFloat = "900";
  dom.host.querySelector("#reading")!.append(article as unknown as Node);
  Object.defineProperty(article, "getBoundingClientRect", {
    value: () => ({
      top: 300,
      bottom: 1200,
      height: 900,
      left: 0,
      right: 300,
      width: 300,
    }),
  });
  const pans: { x: number; y: number }[] = [],
    commands: Command[] = [],
    dispose = bindInput(dom.host, {
      dispatch: (command) => commands.push(command),
      pan: (delta) => pans.push(delta),
      zoom: () => {},
      camera: () => ({ x: 0, y: 0, z: 1, rotation: 0 }),
      grasp: () => {},
      graspGeometry: () => null,
      overview: () => false,
      loading: () => false,
      exitLoading: () => {},
      resolve: () => undefined,
    });
  try {
    article.dispatchEvent(
      new dom.window.WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
      }),
    );
    assert.deepEqual(pans, []);
    assert.deepEqual(commands, [
      { type: "float-text", delta: 120 * 0.72, maxOffset: 900 },
    ]);
    article.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      }),
    );
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 50,
        clientY: 50,
      }),
    );
    assert.equal(pans.length, 0);
    assert.equal(commands.length, 1);
  } finally {
    dispose();
    dom.close();
  }
});
test("list settings keep their structure and invalidate height after active options change", () => {
  const dom = setupDOM(),
    field = create(),
    settle = advance(field);
  field.dispatch({ type: "navigate", target: "s1" });
  settle();
  const scene = new Scene(dom.host, field.catalog);
  let measurements = 0;
  scene.render(field.state);
  const article = dom.host.querySelector<HTMLElement>("#text-s1")!;
  Object.defineProperty(
    article.querySelector(".note-content")!,
    "offsetHeight",
    {
      get: () => {
        measurements++;
        return 300;
      },
    },
  );
  try {
    scene.invalidateLayout();
    scene.render(field.state);
    assert.ok(
      article.querySelector(
        ".shuyra-list.is-vertical .shuyra-list.is-horizontal",
      ),
    );
    assert.ok(measurements > 0);
    const before = measurements;
    field.dispatch({ type: "navigate", target: "act:toggle_range" });
    scene.render(field.state);
    assert.ok(measurements > before);
    assert.equal(
      article
        .querySelector('[data-target="act:toggle_range"]')
        ?.getAttribute("aria-pressed"),
      "true",
    );
  } finally {
    scene.destroy();
    dom.close();
  }
});
