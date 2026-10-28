import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { THEME_OPTIONS } from "../src/core/palette.ts";
import { BACKGROUND_OPTIONS } from "../src/core/background.ts";
import { readBackground, saveBackground } from "../src/platform/preferences.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Scene } from "../src/rendering/scene.ts";
import { Background } from "../src/effects/background.ts";
import { Stars } from "../src/effects/stars.ts";

const camera = { x: 0, y: 0, z: 1, rotation: 0 },
  viewport = { width: 1280, height: 800 };
function dom() {
  const window = new Window(),
    saved = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  const root = window.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  return {
    window,
    root,
    close() {
      window.close();
      Object.assign(globalThis, { document: saved });
    },
  };
}
test("background choices persist safely and tolerate invalid or unavailable browser storage", () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    };
  for (const mode of BACKGROUND_OPTIONS) {
    saveBackground(mode.value, storage);
    assert.equal(readBackground(storage), mode.value);
  }
  values.set("shuyra.background", "unknown");
  assert.equal(readBackground(storage), "flow");
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.equal(readBackground(blocked), "flow");
  assert.doesNotThrow(() => saveBackground("stars", blocked));
});
test("background selection and reset preserve reading state and the hub theme", () => {
  const f = new Field(new Catalog(hubDefinitions, rawContent), viewport),
    before = { ...f.state.camera },
    theme = f.state.theme;
  for (const mode of BACKGROUND_OPTIONS) {
    f.dispatch({ type: "navigate", target: `act:${mode.action}` });
    assert.equal(f.state.settings.background, mode.value);
    assert.equal(f.selected().id, "a0");
    assert.equal(f.state.theme, theme);
    assert.deepEqual(f.state.camera, before);
  }
  f.dispatch({ type: "navigate", target: "act:background_stars" });
  f.dispatch({ type: "navigate", target: "act:reset_defaults" });
  assert.equal(f.state.settings.background, "flow");
});
test("background switching shows only one layer and off performs no background work", () => {
  const d = dom(),
    bg = new Background(d.root as unknown as SVGGElement);
  try {
    bg.render("stars", camera, viewport, 7000, [], false, false, "dark", false);
    assert.equal(
      d.root.querySelector<HTMLElement>(".background-flow")!.style.display,
      "none",
    );
    assert.notEqual(
      d.root.querySelector<HTMLElement>(".background-stars")!.style.display,
      "none",
    );
    const count = d.root.querySelectorAll("*").length;
    bg.render("flow", camera, viewport, 8000, [], false, false, "dark", false);
    assert.equal(
      d.root.querySelector<HTMLElement>(".background-stars")!.style.display,
      "none",
    );
    bg.render("none", camera, viewport, 9000, [], false, false, "dark", false);
    const observer = new d.window.MutationObserver(() => {});
    observer.observe(d.root, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    bg.render(
      "none",
      camera,
      viewport,
      20000,
      [],
      false,
      false,
      "light",
      false,
    );
    assert.equal(observer.takeRecords().length, 0);
    assert.equal(d.root.querySelectorAll("*").length, count);
    observer.disconnect();
  } finally {
    d.close();
  }
});
test("starfield gradients and meteors stay finite across themes, zoom and motion settings", () => {
  const d = dom(),
    stars = new Stars(d.root as unknown as SVGGElement);
  try {
    for (const { value: theme } of THEME_OPTIONS)
      for (const z of [0.18, 1.12, 2.4])
        for (const time of [0, 2800, 7200, 13000]) {
          stars.render({ ...camera, z }, viewport, time, theme, false, false);
          for (const path of d.root.querySelectorAll("path"))
            assert.doesNotMatch(
              path.getAttribute("d") ?? "",
              /NaN|Infinity|undefined/,
            );
        }
    assert.equal(d.root.querySelectorAll(".star-trail").length, 72);
    assert.equal(d.root.querySelectorAll("linearGradient").length, 74);
    stars.render(camera, viewport, 7200, "dark", false, false);
    assert.ok(
      [...d.root.querySelectorAll<HTMLElement>(".star-meteor")].some(
        (p) => p.style.display !== "none",
      ),
    );
    stars.render(camera, viewport, 7200, "dark", true, false);
    assert.ok(
      [...d.root.querySelectorAll<HTMLElement>(".star-meteor")].every(
        (p) => p.style.display === "none",
      ),
    );
    const observer = new d.window.MutationObserver(() => {});
    observer.observe(d.root, { attributes: true, subtree: true });
    stars.render(camera, viewport, 16000, "dark", true, false);
    assert.equal(observer.takeRecords().length, 0);
    observer.disconnect();
  } finally {
    d.close();
  }
});
test("background settings display the selected option without changing page or theme", () => {
  const d = dom();
  d.window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const f = new Field(new Catalog(hubDefinitions, rawContent), viewport, true);
  f.dispatch({ type: "navigate", target: "s6" });
  for (let i = 1; i <= 100; i++) f.update(i * 20, 20);
  const host = d.window.document.querySelector("#scene")!,
    scene = new Scene(host as unknown as HTMLElement, f.catalog);
  try {
    scene.render(f.state);
    f.dispatch({ type: "navigate", target: "act:background_stars" });
    scene.render(f.state);
    assert.equal(
      host
        .querySelector('[data-target="act:background_stars"]')!
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      host
        .querySelector('[data-target="act:background_flow"]')!
        .getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(f.selected().id, "s6");
    assert.equal(f.state.theme, "dark");
  } finally {
    scene.destroy();
    d.close();
  }
});
test("theme choices show exactly the active palette", () => {
  const d = dom();
  d.window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const f = new Field(new Catalog(hubDefinitions, rawContent), viewport, true);
  f.dispatch({ type: "navigate", target: "s6" });
  for (let i = 1; i <= 100; i++) f.update(i * 20, 20);
  const host = d.window.document.querySelector("#scene")!;
  const scene = new Scene(host as unknown as HTMLElement, f.catalog);
  try {
    for (const selected of THEME_OPTIONS) {
      f.dispatch({ type: "navigate", target: `act:${selected.action}` });
      scene.render(f.state);
      assert.equal(f.selected().id, "s6");
      assert.equal(f.state.theme, selected.value);
      for (const option of THEME_OPTIONS) {
        assert.equal(
          host.querySelector(`[data-target="act:${option.action}"]`)!
            .getAttribute("aria-pressed"),
          String(option.value === selected.value),
        );
      }
    }
  } finally {
    scene.destroy();
    d.close();
  }
});
