import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { Scene } from "../src/rendering/scene.ts";
import { Ambient } from "../src/effects/ambient.ts";
import { createLoading } from "../src/effects/loading.js";
import { LOCAL_LABEL_TURN_MS } from "../src/rendering/local-labels.ts";
test("scene switches circle/line expressions and renders links as real buttons", () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const host = window.document.querySelector("#scene")!;
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1896,
    height: 1016,
  });
  const scene = new Scene(host as unknown as HTMLElement, field.catalog);
  scene.render(field.state);
  let article = host.querySelector("#text-a0")!;
  assert.equal(article.getAttribute("hidden"), null);
  assert.equal(article.querySelector("h2")?.textContent, "从这里开始");
  assert.equal(
    article.querySelector("button")?.getAttribute("data-target"),
    "a1",
  );
  assert.equal(article.getAttribute("data-presentation"), "circle");
  field.dispatch({ type: "morph" });
  for (let now = 20; now <= 1600; now += 20) field.update(now, 20);
  scene.render(field.state);
  assert.equal(article.getAttribute("data-presentation"), "line");
  assert.ok(scene.actions.size > 0);
  field.dispatch({ type: "overview" });
  scene.render(field.state);
  assert.ok(article.hasAttribute("hidden"));
  assert.equal(article.getAttribute("aria-hidden"), "true");
  const refocus = scene.actions.get("hud:refocus");
  assert.deepEqual(refocus, { type: "focus", hub: field.state.focus });
  field.dispatch(refocus!);
  for (let now = 1620; now <= 3200; now += 20) field.update(now, 20);
  scene.render(field.state);
  assert.equal(field.state.overview, false);
  assert.equal(article.hasAttribute("hidden"), false);
  scene.destroy();
  assert.equal(host.querySelectorAll("article").length, 0);
  window.close();
});
test("flow background and original V24 kernel render finite paths through a full lifecycle", () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const group = window.document.querySelector("#gDecorations")!;
  const ambient = new Ambient(group as unknown as SVGGElement);
  ambient.render(
    { x: 25, y: 65, z: 0.54, rotation: 0 },
    { width: 1896, height: 1016 },
    1500,
    [],
    true,
    false,
  );
  assert.equal(group.querySelectorAll(".flow-line").length, 35);
  assert.equal(
    group.querySelectorAll(".decor-string,.decor-ripple,.decor-morph").length,
    0,
  );
  let finished = false;
  const overlay = window.document.querySelector("#loadingOverlay")!;
  const loader = createLoading(
    overlay as unknown as HTMLElement,
    () => (finished = true),
    () => {},
  );
  loader.start();
  for (let i = 0; i < 250; i++) loader.update(50, 1);
  assert.equal(finished, true);
  for (const path of window.document.querySelectorAll("path"))
    assert.doesNotMatch(path.getAttribute("d") ?? "", /NaN|Infinity/);
  window.close();
});
test("unchanged reading state performs no article DOM writes and preserves navigation actions", () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const host = window.document.querySelector("#scene")!,
    field = new Field(new Catalog(hubDefinitions, rawContent), {
      width: 1896,
      height: 1016,
    });
  const scene = new Scene(host as unknown as HTMLElement, field.catalog);
  scene.render(field.state);
  field.state.elapsed += LOCAL_LABEL_TURN_MS;
  scene.render(field.state);
  const actions = [...scene.actions.entries()];
  const observer = new window.MutationObserver(() => {});
  observer.observe(host.querySelector("#reading")!, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  for (let i = 0; i < 120; i++) {
    field.state.elapsed += 16.67;
    scene.render(field.state);
  }
  assert.equal(observer.takeRecords().length, 0);
  assert.deepEqual([...scene.actions.entries()], actions);
  field.zoom(1.2, { x: 900, y: 500 });
  scene.render(field.state);
  assert.ok(observer.takeRecords().length > 0);
  observer.disconnect();
  scene.destroy();
  window.close();
});
test("background resampling stays within its idle work budget", () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  const group = window.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  window.document.body.append(group);
  const ambient = new Ambient(group as unknown as SVGGElement),
    observer = new window.MutationObserver(() => {});
  observer.observe(group, {
    attributes: true,
    subtree: true,
    attributeFilter: ["d"],
  });
  for (let i = 0; i < 120; i++)
    ambient.render(
      { x: 25, y: 65, z: 0.54, rotation: 0 },
      { width: 1896, height: 1016 },
      (i * 1000) / 60,
      [],
      true,
      false,
    );
  const writes = observer.takeRecords().length;
  assert.ok(writes > 0 && writes < 250, `${writes} path rewrites`);
  assert.equal(group.hasAttribute("filter"), false);
  observer.disconnect();
  window.close();
});
test("frame rate selection is visible and updates without changing presentation", () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1896,
    height: 1016,
  });
  field.dispatch({ type: "navigate", target: "s4" });
  for (let i = 1; i <= 80; i++) field.update(i * 20, 20);
  const host = window.document.querySelector("#scene")!,
    scene = new Scene(host as unknown as HTMLElement, field.catalog);
  scene.render(field.state);
  const selected = () =>
    host
      .querySelector('#text-s4 button[aria-pressed="true"]')
      ?.getAttribute("data-target");
  assert.equal(selected(), "act:fpsadaptive");
  field.dispatch({ type: "navigate", target: "act:fpsdisplay" });
  scene.render(field.state);
  assert.equal(selected(), "act:fpsdisplay");
  scene.destroy();
  window.close();
});

test("different-background travel keeps one continuous color sweep while the content commits", () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const host = window.document.querySelector("#scene")!;
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1366,
    height: 820,
  });
  const scene = new Scene(host as unknown as HTMLElement, field.catalog);
  field.dispatch({ type: "navigate", target: "d0" });
  scene.render(field.state);
  assert.equal(host.getAttribute("data-transition"), "passage");
  const begin = host.querySelector("#portalBoundaryPath")!.getAttribute("d")!;
  field.update(540, 20);
  scene.render(field.state);
  assert.equal(
    host
      .querySelector("#gLabels")!
      .getAttribute("style")
      ?.includes("pointer-events: none"),
    true,
  );
  const midpoint = host
    .querySelector("#portalBoundaryPath")!
    .getAttribute("d")!;
  assert.notEqual(midpoint, begin);
  assert.equal(
    host.querySelector("#portalViewport")!.getAttribute("visibility"),
    "visible",
  );
  for (let now = 560; now <= 1600; now += 20) field.update(now, 20);
  scene.render(field.state);
  assert.equal(host.getAttribute("data-transition"), null);
  assert.equal(
    host.querySelector("#portalViewport")!.getAttribute("visibility"),
    "hidden",
  );
  scene.destroy();
  window.close();
});

test("same-background near, flight, remote and axis travel never draw a color mask or fold hubs", () => {
  for (const kind of ["near", "flight", "remote", "axis"] as const) {
    const window = new Window(),
      saved = globalThis.document;
    Object.assign(globalThis, { document: window.document });
    window.document.write(
      readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
        /<script[^>]*>[\s\S]*?<\/script>/g,
        "",
      ),
    );
    const field = new Field(new Catalog(hubDefinitions, rawContent), {
      width: 1366,
      height: 820,
    });
    const host = window.document.querySelector("#scene")!;
    const scene = new Scene(host as unknown as HTMLElement, field.catalog);
    try {
      const target = field.state.hubs.B,
        source = field.state.hubs.A;
      target.center = {
        x:
          source.center.x +
          (kind === "near" ? 100 : kind === "remote" ? 4000 : 1000),
        y: source.center.y,
      };
      if (kind === "axis") target.parentHub = "A";
      const camera = { ...field.state.camera };
      field.dispatch({ type: "navigate", target: "b0" });
      const passage = field.state.passage!;
      assert.equal(passage.kind, kind);
      for (const phase of [0, 0.25, 0.5, 0.75, 0.99]) {
        field.update(passage.duration * phase, 20);
        scene.render(field.state);
        assert.equal(host.getAttribute("data-transition"), "passage");
        assert.equal(
          host.querySelector("#portalViewport")!.getAttribute("visibility"),
          "hidden",
        );
        assert.equal(
          (host.querySelector("#portalStroke")! as unknown as HTMLElement).style
            .opacity,
          "0",
        );
        assert.equal(
          (host.querySelector("#portalEchoStroke")! as unknown as HTMLElement)
            .style.opacity,
          "0",
        );
        assert.equal(
          host.querySelector("#baseBg")!.getAttribute("fill")!.toLowerCase(),
          "#f5f6f2",
        );
        assert.equal(source.fold, 0);
        assert.equal(target.fold, 0);
      }
      assert.notDeepEqual(
        field.state.camera,
        camera,
        "camera travel remains active without a mask",
      );
      field.update(passage.duration + 20, 20);
      scene.render(field.state);
      assert.equal(field.state.focus, "B");
      assert.equal(host.getAttribute("data-transition"), null);
    } finally {
      scene.destroy();
      window.close();
      Object.assign(globalThis, { document: saved });
    }
  }
});

test("same-background travel clears a preceding color mask and reverse history uses the same color condition", () => {
  const window = new Window(),
    saved = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1366,
    height: 820,
  });
  const host = window.document.querySelector("#scene")!;
  const scene = new Scene(host as unknown as HTMLElement, field.catalog);
  let now = 0;
  const finish = () => {
    now += field.state.passage!.duration + 20;
    field.update(now, 20);
  };
  const mask = () =>
    host.querySelector("#portalViewport")!.getAttribute("visibility");
  try {
    field.dispatch({ type: "navigate", target: "d0" });
    field.update(field.state.passage!.duration * 0.25, 20);
    scene.render(field.state);
    assert.equal(mask(), "visible");
    finish();
    field.dispatch({ type: "navigate", target: "s0" });
    scene.render(field.state);
    assert.equal(
      mask(),
      "hidden",
      "a stale dark-theme sweep must not survive into dark-to-dark travel",
    );
    finish();
    field.dispatch({ type: "back" });
    scene.render(field.state);
    assert.equal(mask(), "hidden");
    finish();
    field.dispatch({ type: "back" });
    scene.render(field.state);
    assert.equal(
      mask(),
      "visible",
      "dark-to-light history return still sweeps",
    );
    assert.equal(
      host.querySelector("#portalBg")!.getAttribute("fill"),
      "#F5F6F2",
    );
  } finally {
    scene.destroy();
    window.close();
    Object.assign(globalThis, { document: saved });
  }
});

test("articles mount on demand and keep an LRU of eight inactive entries with focus protection", () => {
  const window = new Window();
  Object.assign(globalThis, { document: window.document });
  window.document.write(readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script[^>]*>[\s\S]*?<\/script>/g, ""));
  const host = window.document.querySelector<HTMLElement>("#scene")!;
  const field = new Field(new Catalog(hubDefinitions, rawContent), { width: 1366, height: 820 });
  field.state.settings.range = 0.1;
  field.state.settings.background = "none";
  const scene = new Scene(host, field.catalog, { renderer: "svg", background: false });
  try {
    assert.equal(host.querySelectorAll("article").length, 0);
    scene.render(field.state);
    const initial = host.querySelector<HTMLElement>("#text-a0")!;
    const focused = initial.querySelector<HTMLButtonElement>("button")!;
    focused.focus();
    let time = 0;
    const targets = [...field.catalog.chapters.values()].filter(node => node.hub !== "Q" && node.id !== "a0").slice(0, 14);
    for (const node of targets) {
      field.dispatch({ type: "navigate", target: node.id });
      for (let step = 0; step < 100; step++) field.update(time += 20, 20);
      scene.render(field.state);
      assert.ok(host.querySelector(`#text-${node.id}`));
      const visible = host.querySelectorAll("article:not([hidden])").length;
      assert.ok(host.querySelectorAll("article").length <= visible + 8);
    }
    assert.ok(initial.isConnected);
    assert.ok(window.document.activeElement === focused);
  } finally { scene.destroy(); window.close(); }
});
