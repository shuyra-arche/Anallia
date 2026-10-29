import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { SvgGraphicsRenderer } from "../src/rendering/graphics/svg-renderer.ts";
import { emptySceneFrame, sceneLayer } from "../src/core/graphics.ts";
import type { BackgroundFrame, LabelFrame, PortalFrame, SceneFrame, SceneMask } from "../src/core/graphics.ts";
import { evaluateSymbol } from "../src/core/symbol-morph.ts";
import { ICON_TOKENS } from "../src/core/icons.ts";

const NS = "http://www.w3.org/2000/svg";

interface Fixture {
  window: Window;
  document: Document;
  root: SVGSVGElement;
  close(): void;
}

function fixture(): Fixture {
  const window = new Window({ url: "https://field.test/" });
  const document = window.document;
  const root = document.createElementNS(NS, "svg") as unknown as SVGSVGElement;
  root.setAttribute("viewBox", "0 0 800 600");
  document.body.append(root as unknown as Node);
  return {
    window,
    document,
    root,
    close() {
      window.close();
    },
  };
}

function frame(patch: Partial<SceneFrame> = {}): SceneFrame {
  const base = emptySceneFrame("svg", { width: 800, height: 600 }, { x: 0, y: 0, z: 1, rotation: 0 }, "light");
  return { ...base, ...patch };
}

function label(patch: Partial<LabelFrame> = {}): LabelFrame {
  return {
    id: "Q:op",
    command: { type: "navigate", target: "a1" },
    aria: "检索",
    hubId: "Q",
    glyph: "⌕",
    visual: "nav",
    contentKind: "icon",
    layout: {
      hinge: { x: 100, y: 120 },
      position: { x: 160, y: 200 },
      offset: { x: 60, y: 80 },
      degree: 53,
      width: 44,
      height: 44,
      scale: 1,
    },
    opacity: 1,
    interactive: true,
    page: null,
    ...patch,
  };
}

function portal(maskId = "portal"): PortalFrame {
  return {
    visible: true,
    opacity: 0.5,
    fill: "#f5f6f2",
    maskId,
    stroke: { path: { kind: "circle", cx: 400, cy: 300, radius: 120 }, color: "#256b63", opacity: 0.8, width: 1.1 },
  };
}

function mask(patch: Partial<SceneMask> = {}): SceneMask {
  return {
    id: "portal",
    visible: true,
    opacity: 1,
    rule: "evenodd",
    shapes: [{ kind: "circle", cx: 400, cy: 300, radius: 120 }],
    outerRect: { x: 0, y: 0, width: 800, height: 600 },
    ...patch,
  };
}

function background(): BackgroundFrame {
  return {
    mode: "stars",
    theme: "light",
    opacity: 1,
    streamlines: [],
    stars: [{ at: { x: 10, y: 20 }, radius: 1.5, fill: "#fff", opacity: 0.8 }],
    trails: [],
    meteors: [
      { from: { x: 0, y: 0 }, to: { x: 50, y: 60 }, head: { x: 50, y: 60 }, headRadius: 2, width: 1, opacity: 1, color: "#fff" },
    ],
  };
}

/** Normal scene layer orders. */
function normalLayers() {
  return [
    sceneLayer("base", 0, [{ type: "rect", x: 0, y: 0, width: 800, height: 600, fill: "#fff" }]),
    sceneLayer("portal", 10),
    sceneLayer("background", 20),
    sceneLayer("hubs", 30, [{ type: "circle", cx: 10, cy: 10, radius: 4, stroke: "#000" }]),
    sceneLayer("relations", 40),
    sceneLayer("labels", 50),
    sceneLayer("reading", 60),
    sceneLayer("loading", 70, [{ type: "polyline", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], stroke: "#000" }]),
  ];
}

interface Write {
  target: Node;
  property: string;
}

/** happy-dom has no MutationObserver; wrap the DOM writers the renderer can use. */
function trackWrites(window: Window): Write[] {
  const writes: Write[] = [];
  const view = window as unknown as {
    Element: { prototype: object };
    Node: { prototype: object };
    CSSStyleDeclaration: { prototype: object };
  };
  const proto = (target: object, name: string) => {
    const description = Object.getOwnPropertyDescriptor(target, name);
    assert.ok(description, `missing ${name}`);
    return description!;
  };
  const record = (target: Node, property: string) => writes.push({ target, property });
  const setAttribute = proto(view.Element.prototype, "setAttribute");
  Object.defineProperty(view.Element.prototype, "setAttribute", {
    configurable: true,
    writable: true,
    value: function (this: Element, name: string, value: string) {
      record(this, `attr:${name}`);
      return setAttribute.value!.call(this, name, value);
    },
  });
  const removeAttribute = proto(view.Element.prototype, "removeAttribute");
  Object.defineProperty(view.Element.prototype, "removeAttribute", {
    configurable: true,
    writable: true,
    value: function (this: Element, name: string) {
      if (this.hasAttribute(name)) record(this, `attr:${name}`);
      return removeAttribute.value!.call(this, name);
    },
  });
  for (const method of ["append", "insertBefore", "replaceChildren", "remove", "prepend", "appendChild"]) {
    const description = Object.getOwnPropertyDescriptor(view.Node.prototype, method) ?? Object.getOwnPropertyDescriptor(view.Element.prototype, method);
    if (!description) continue;
    Object.defineProperty(view.Node.prototype, method, {
      configurable: true,
      writable: true,
      value: function (this: Node, ...args: unknown[]) {
        record(this, method);
        return description.value!.apply(this, args);
      },
    });
  }
  const text = proto(view.Node.prototype, "textContent");
  Object.defineProperty(view.Node.prototype, "textContent", {
    configurable: true,
    get: text.get,
    set(this: Node, value: string | null) {
      if (this.textContent !== value) record(this, "textContent");
      text.set!.call(this, value);
    },
  });
  const setProperty = proto(view.CSSStyleDeclaration.prototype, "setProperty");
  Object.defineProperty(view.CSSStyleDeclaration.prototype, "setProperty", {
    configurable: true,
    writable: true,
    value: function (this: CSSStyleDeclaration, name: string, value: string | null, priority?: string) {
      if (this.getPropertyValue(name) !== (value ?? "")) record(this, `style:${name}`);
      return setProperty.value!.call(this, name, value, priority);
    },
  });
  return writes;
}

function layerOrder(root: SVGSVGElement, active: readonly string[]): string[] {
  return Array.from(root.querySelectorAll(".svg-layer"))
    .map((node) => node.getAttribute("data-layer") ?? "")
    .filter((id) => active.includes(id));
}

function describeWrites(writes: Write[]): string {
  return writes
    .map(
      (write) =>
        `${write.property}@${(write.target as unknown as Element).tagName}.${(write.target as unknown as Element).getAttribute?.("class") ?? ""}`,
    )
    .join(", ");
}

const ACTIVE = ["base", "portal", "background", "hubs", "relations", "labels", "reading", "loading"];

test("normal frame.layers order keeps loading 70 after labels 50 and portal strokes before labels", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(frame({ layers: normalLayers(), labels: [label()], masks: [mask()], portal: portal(), background: background() }));
    assert.deepEqual(layerOrder(f.root, ACTIVE), ACTIVE);
    const strokes = f.root.querySelector(".svg-portal-strokes")!;
    assert.equal(strokes.getAttribute("data-layer"), null);
    assert.ok(strokes.contains(f.root.querySelector(".portal-stroke") as unknown as Node));
    const labelLayer = f.root.querySelector('[data-layer="labels"]')!;
    assert.ok(layerOrder(f.root, ACTIVE).indexOf("portal") >= 0);
    const graphicsChildren = Array.from(renderer.graphics.children);
    assert.ok(graphicsChildren.indexOf(strokes) < graphicsChildren.indexOf(labelLayer));
    assert.equal(f.root.querySelector(".portal-fill")!.closest(".svg-layer")!.getAttribute("data-layer"), "portal");
    assert.equal(f.root.getAttribute("aria-hidden"), null, "caller root is not touched");
    assert.equal(f.root.querySelector(".svg-graphics")!.getAttribute("aria-hidden"), "true");
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("a deliberately early loading layer (order 5) is painted before labels", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const layers = normalLayers().map((layer) => (layer.id === "loading" ? sceneLayer("loading", 5, layer.primitives) : layer));
    renderer.render(frame({ layers, labels: [label()], masks: [mask()], portal: portal(), background: background() }));
    const order = layerOrder(f.root, ACTIVE);
    assert.ok(order.indexOf("loading") < order.indexOf("labels"));
    assert.deepEqual(order.slice(0, 3), ["base", "loading", "portal"]);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("layer order follows changed frame orders without rebuilding layer nodes", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(
      frame({ layers: [sceneLayer("hubs", 30, [{ type: "circle", cx: 1, cy: 1, radius: 1 }]), sceneLayer("base", 0)] }),
    );
    assert.deepEqual(layerOrder(f.root, ["base", "hubs"]), ["base", "hubs"]);
    const hubLayer = f.root.querySelector('[data-layer="hubs"]');
    renderer.render(frame({ layers: [sceneLayer("hubs", -5), sceneLayer("base", 10)] }));
    assert.deepEqual(layerOrder(f.root, ["base", "hubs"]), ["hubs", "base"]);
    assert.equal(f.root.querySelector('[data-layer="hubs"]'), hubLayer);
    assert.equal(hubLayer!.querySelector(".svg-circle"), null, "dropped primitives are removed");
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("numeric circle, polyline and text primitives paint in place without coordinate transforms", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(
      frame({
        camera: { x: 400, y: 300, z: 2.5, rotation: 0.3 },
        layers: [
          sceneLayer("hubs", 30, [
            { type: "circle", cx: 120, cy: 80, radius: 12, stroke: "#256b63", strokeWidth: 1.5, dash: [4, 6] },
            { type: "polyline", points: [{ x: 0, y: 0 }, { x: 10.5, y: 20 }, { x: 40, y: 5 }], stroke: "#000", closed: true },
            { type: "text", x: 300, y: 200, text: "从这里开始", fontSize: 16.5 },
          ]),
        ],
      }),
    );
    const circle = f.root.querySelector(".svg-circle")!;
    assert.equal(circle.getAttribute("cx"), "120");
    assert.equal(circle.getAttribute("cy"), "80");
    assert.equal(circle.getAttribute("r"), "12");
    assert.equal(circle.getAttribute("stroke-dasharray"), "4 6");
    assert.equal(f.root.querySelector(".svg-polyline")!.getAttribute("d"), "M0 0L10.5 20L40 5Z");
    assert.equal(f.root.querySelector(".svg-text")!.textContent, "从这里开始");
    assert.equal(circle.closest(".svg-graphics")!.getAttribute("transform"), null);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("text primitive honours scale, fontWeight, alignment and rotation", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(
      frame({
        layers: [
          sceneLayer("hubs", 30, [
            {
              type: "text",
              x: 200,
              y: 100,
              text: "錨",
              fontSize: 18,
              fontWeight: 720,
              scale: 1.5,
              angle: 30,
              align: "left",
              baseline: "middle",
              fill: "#233532",
            },
          ]),
        ],
      }),
    );
    const text = f.root.querySelector(".svg-text")!;
    assert.equal(text.getAttribute("font-weight"), "720");
    assert.equal(text.getAttribute("text-anchor"), "start");
    assert.equal(text.getAttribute("dominant-baseline"), "middle");
    assert.equal(text.getAttribute("fill"), "#233532");
    assert.match(text.getAttribute("transform") ?? "", /rotate\(30 200 100\)/);
    assert.match(text.getAttribute("transform") ?? "", /scale\(1\.5\)/);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("masks render as unique clipPath elements combining outerRect and hole subpaths under the frame rule", () => {
  const f = fixture();
  try {
    const a = new SvgGraphicsRenderer(f.root, { idPrefix: "ra" });
    const b = new SvgGraphicsRenderer(f.root, { idPrefix: "rb" });
    const scene = frame({ layers: normalLayers(), masks: [mask()], portal: portal(), labels: [label()], background: background() });
    a.render(scene);
    b.render({ ...scene, portal: { ...portal(), fill: "#10191b" } });
    const clips = Array.from(f.root.querySelectorAll("clipPath"));
    assert.equal(clips.length, 2);
    assert.deepEqual(clips.map((node) => node.id), ["ra-clip-portal", "rb-clip-portal"]);
    for (const clip of clips) {
      assert.equal(clip.getAttribute("clipPathUnits"), "userSpaceOnUse");
      const paths = clip.querySelectorAll("path");
      assert.equal(paths.length, 1);
      assert.equal(paths[0].getAttribute("fill-rule"), "evenodd");
      assert.equal(paths[0].getAttribute("clip-rule"), "evenodd");
      assert.equal(paths[0].getAttribute("d"), "M0 0H800V600H0ZM280 300A120 120 0 1 1 520 300A120 120 0 1 1 280 300Z");
    }
    for (const renderer of [a, b])
      assert.equal(
        renderer.layer("portal").querySelector(".portal-fill")!.getAttribute("clip-path"),
        `url(#${renderer.idPrefix}-clip-portal)`,
      );
    assert.equal(f.root.querySelector("mask"), null, "no mask elements are used");
    a.destroy();
    b.destroy();
  } finally {
    f.close();
  }
});

test("nonzero clip without an outer rect uses the numbered face subpaths", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(
      frame({
        masks: [
          mask({
            rule: "nonzero",
            outerRect: undefined,
            fill: "#eaf2f3",
            shapes: [{ kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }],
          }),
        ],
        portal: portal(),
      }),
    );
    const path = f.root.querySelector("clipPath path")!;
    assert.equal(path.getAttribute("clip-rule"), "nonzero");
    assert.equal(path.getAttribute("fill"), "#eaf2f3");
    assert.equal(path.getAttribute("d"), "M0 0L100 0L100 100");
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("dynamic symbol geometry becomes numeric path data without reading the d getter", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const geometry = evaluateSymbol("search", 0.4, 0.2);
    let dReads = 0;
    for (const part of geometry.paths) {
      Object.defineProperty(part, "d", {
        configurable: true,
        enumerable: true,
        get() {
          dReads++;
          throw new Error("renderer must not read SymbolGeometry path strings");
        },
      });
    }
    renderer.render(
      frame({
        layers: normalLayers(),
        labels: [label({ symbolKind: "search", symbolGeometry: geometry, icon: ICON_TOKENS["⌕"] })],
        background: background(),
      }),
    );
    assert.equal(dReads, 0);
    const paths = Array.from(f.root.querySelectorAll(".symbol-path"));
    assert.equal(paths.length, geometry.paths.length);
    paths.forEach((node, index) => {
      const expected = geometry.paths[index].points
        .map((point, i) => `${i ? "L" : "M"}${Math.round(point.x * 1000) / 1000} ${Math.round(point.y * 1000) / 1000}`)
        .join("");
      assert.equal(node.getAttribute("d"), expected);
    });
    assert.equal(f.root.querySelectorAll(".symbol-point").length, geometry.points.length);
    assert.equal(f.root.querySelector(".label-icon-glyph")!.getAttribute("data-symbol-morph"), "0.4000");
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("static icon token shapes are created once and reused across frames", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const token = ICON_TOKENS["⌕"];
    const staticLabel = label({ id: "Q:search", glyph: "⌕", contentKind: "icon", icon: token });
    const scene = frame({ layers: normalLayers(), labels: [staticLabel], background: background() });
    renderer.render(scene);
    const icon = f.root.querySelector(".label-icon")!;
    const glyph = f.root.querySelector(".label-icon-glyph")!;
    assert.equal(glyph.childElementCount, token.shapes.length);
    const shapes = Array.from(glyph.childNodes);
    renderer.render({ ...scene, labels: [{ ...staticLabel, layout: { ...staticLabel.layout, scale: 1.4 } }] });
    assert.equal(f.root.querySelector(".label-icon"), icon);
    assert.deepEqual(Array.from(glyph.childNodes), shapes);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("labels separate pin, stem, page squash and the rotated visual group", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(
      frame({
        layers: normalLayers(),
        background: background(),
        labels: [
          label({
            id: "Q:page",
            glyph: "从这里开始",
            visual: "ordinary",
            contentKind: "text",
            icon: undefined,
            page: { angle: 0.2, squash: 0.7, opacity: 0.9, incoming: true, interactive: false },
          }),
        ],
      }),
    );
    const group = f.root.querySelector(".tag-group")!;
    const pin = group.querySelector(".page-pin")!;
    assert.equal(pin.parentNode, group);
    assert.equal(pin.getAttribute("transform"), null);
    const leaf = group.querySelector(".page-leaf")!;
    const stem = leaf.querySelector(".stem")!;
    const visual = leaf.querySelector(".label-visual")!;
    assert.equal(stem.getAttribute("transform"), null);
    const d = stem.getAttribute("d") ?? "";
    assert.match(d, /^M0 0L/);
    const [, sx, sy] = /M0 0L(-?[\d.]+) (-?[\d.]+)/.exec(d) ?? [];
    assert.ok(Math.abs(Math.hypot(Number(sx), Number(sy)) - (Math.hypot(60, 80) - 14)) < 0.01);
    const axis = (Math.atan2(80, 60) * 180) / Math.PI;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    assert.equal(leaf.getAttribute("transform"), `rotate(${round(axis)}) scale(0.7 1) rotate(${round(-axis)})`);
    assert.equal(leaf.getAttribute("opacity"), "0.9");
    assert.equal(visual.getAttribute("transform"), "translate(60 80) rotate(53)");
    assert.ok(visual.contains(leaf.querySelector(".label-ring") as unknown as Node));
    assert.ok(visual.contains(leaf.querySelector(".label-icon") as unknown as Node));
    assert.ok(visual.contains(leaf.querySelector(".label") as unknown as Node));
    assert.equal(f.root.querySelectorAll(".label-visual").length, 1);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("frame feedback drives inline styles and the graphics proxy exposes no interaction", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const base = label({ id: "Q:text", glyph: "从这里开始", visual: "current", contentKind: "text", icon: undefined });
    const scene = frame({ layers: normalLayers(), labels: [base], background: background() });
    renderer.render(scene);
    const group = f.root.querySelector(".tag-group")!;
    const text = group.querySelector("text")!;
    const ring = group.querySelector(".label-ring")!;
    assert.match(text.getAttribute("class") ?? "", /\bis-text\b/, "current text keeps the sans is-text class");
    assert.match(text.getAttribute("class") ?? "", /\bcurrent\b/);
    assert.equal(text.style.fill, "");
    assert.equal(ring.style.getPropertyValue("opacity"), "0.65");
    assert.equal(group.getAttribute("role"), null);
    assert.equal(group.getAttribute("tabindex"), null);
    assert.equal(group.getAttribute("data-command"), null);
    assert.equal(group.getAttribute("pointer-events"), null);
    const hit = group.querySelector(".label-hit")!;
    assert.equal(hit.getAttribute("pointer-events"), null, "no attribute override");
    assert.equal(hit.style.getPropertyValue("pointer-events"), "none", "inline style keeps the proxy inert");

    const writes = trackWrites(f.window);
    renderer.render(scene);
    assert.equal(writes.length, 0, `static frame wrote: ${describeWrites(writes)}`);
    const feedback = { ...scene, labels: [{ ...base, resonating: true, interaction: { hover: true, focus: false, press: false, active: false } }] };
    renderer.render(feedback);
    const feedbackWrites = writes.length;
    assert.ok(feedbackWrites > 0);
    renderer.render({ ...feedback, labels: [{ ...feedback.labels[0] }] });
    assert.equal(writes.length, feedbackWrites, "unchanged feedback writes nothing");
    assert.equal(text.style.fill, "var(--amber)");
    assert.equal(ring.style.getPropertyValue("opacity"), "1");
    assert.equal(f.root.querySelectorAll("[role=button],[tabindex]").length, 0);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("repeated and equal-value frames perform no DOM writes", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const scene = frame({
      labels: [label({ symbolKind: "search", symbolGeometry: evaluateSymbol("search", 0.5, 0.6), icon: ICON_TOKENS["⌕"] })],
      masks: [mask()],
      portal: portal(),
      background: background(),
      layers: normalLayers(),
    });
    renderer.render(scene);
    const writes = trackWrites(f.window);
    renderer.render(scene);
    assert.equal(writes.length, 0, `settled frame wrote: ${describeWrites(writes)}`);
    renderer.render(structuredClone(scene));
    assert.equal(writes.length, 0, `equal-value frame wrote: ${describeWrites(writes)}`);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("a replaced background on the same frame object updates only background nodes", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const scene = frame({ layers: normalLayers(), labels: [label()], masks: [mask()], portal: portal(), background: background() });
    renderer.render(scene);
    const labelGroup = f.root.querySelector(".tag-group")!;
    const star = f.root.querySelector(".star-point")!;
    const next: BackgroundFrame = { ...background(), stars: [{ at: { x: 30, y: 40 }, radius: 2, fill: "#fff", opacity: 0.5 }] };
    const writes = trackWrites(f.window);
    scene.background = next;
    renderer.render(scene);
    assert.ok(writes.length > 0, "background swap writes");
    assert.ok(writes.every((write) => write.target === star), `non-background writes: ${describeWrites(writes)}`);
    renderer.render(scene);
    assert.equal(writes.length, 4, "unchanged background writes nothing");
    assert.equal(f.root.querySelector(".tag-group"), labelGroup);
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("mode switches reuse pooled background nodes and restore their display", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const flowLine = {
      points: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
      marker: { x: 5, y: 5 },
      markerRadius: 1.7,
      width: 1,
      opacity: 0.5,
      markerOpacity: 0.6,
    };
    const stars = frame({ layers: normalLayers(), labels: [label()], background: background() });
    renderer.render(stars);
    const labelGroup = f.root.querySelector(".tag-group")!;
    const flow = frame({ layers: normalLayers(), labels: [label()], background: { ...background(), mode: "flow", streamlines: [flowLine] } });
    renderer.render(flow);
    const flowPath = f.root.querySelector(".flow-line")!;
    const marker = f.root.querySelector(".flow-marker")!;
    assert.equal(flowPath.getAttribute("display"), null);
    assert.equal(marker.getAttribute("display"), null);
    assert.equal(f.root.querySelector(".background-stars")!.getAttribute("display"), "none");
    renderer.render(stars);
    renderer.render(flow);
    assert.equal(f.root.querySelector(".flow-line"), flowPath, "flow line pooled");
    assert.equal(f.root.querySelector(".flow-marker"), marker, "flow marker pooled");
    assert.equal(flowPath.getAttribute("display"), null);
    assert.equal(marker.getAttribute("display"), null);
    assert.equal(f.root.querySelector(".tag-group"), labelGroup, "labels are not rebuilt");
    renderer.destroy();
  } finally {
    f.close();
  }
});

test("destroy removes only the renderer's own nodes", () => {
  const f = fixture();
  try {
    const foreign = f.document.createElementNS(NS, "g");
    foreign.setAttribute("id", "foreign");
    const foreignChild = f.document.createElementNS(NS, "rect");
    foreign.append(foreignChild);
    f.root.append(foreign as unknown as Node);
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(frame({ layers: normalLayers(), labels: [label()], masks: [mask()], portal: portal(), background: background() }));
    const owned = renderer.graphics;
    assert.equal(f.root.contains(owned as unknown as Node), true);
    renderer.destroy();
    assert.equal(f.root.querySelector("#foreign"), foreign);
    assert.equal(foreign.firstChild, foreignChild);
    assert.equal(f.root.contains(owned as unknown as Node), false);
    assert.equal(f.root.querySelector("clipPath"), null);
    assert.equal(f.root.getAttribute("aria-hidden"), null);
    renderer.destroy();
  } finally {
    f.close();
  }
});


test("portal uses its named clip even when a later unrelated mask exists", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root, { idPrefix: "selected-mask" });
    renderer.render(frame({ layers: normalLayers(), masks: [mask(), { ...mask(), id: "other" }], portal: portal() }));
    assert.equal(f.root.querySelector(".portal-fill")!.getAttribute("clip-path"), "url(#selected-mask-clip-portal)");
    const groups = Array.from(renderer.graphics.children);
    const strokes = f.root.querySelector(".svg-portal-strokes")!;
    assert.ok(groups.indexOf(strokes) > groups.indexOf(f.root.querySelector('[data-layer="relations"]')!));
    assert.ok(groups.indexOf(strokes) < groups.indexOf(f.root.querySelector('[data-layer="labels"]')!));
  } finally { f.close(); }
});

test("a revised reused frame updates geometry and a reading layer honors explicit order", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    const next = frame({ layers: [sceneLayer("base", 100), sceneLayer("reading", 0, [{ type: "circle", cx: 10, cy: 20, radius: 3 }])] });
    renderer.render(next);
    assert.deepEqual(layerOrder(f.root, ["base", "reading"]), ["reading", "base"]);
    next.layers[1].primitives[0] = { type: "circle", cx: 30, cy: 40, radius: 5 };
    next.revision++;
    renderer.render(next);
    assert.equal(f.root.querySelector('[data-layer="reading"] circle')!.getAttribute("cx"), "30");
  } finally { f.close(); }
});


test("full circles use two SVG arcs and wrapped short arcs preserve their sweep", () => {
  const f = fixture();
  try {
    const renderer = new SvgGraphicsRenderer(f.root);
    renderer.render(frame({ layers: [sceneLayer("hubs", 30, [
      { type: "arc", cx: 100, cy: 100, radius: 40, startAngle: 0, endAngle: Math.PI * 2, stroke: "#123456" },
      { type: "arc", cx: 100, cy: 100, radius: 40, startAngle: 5.8, endAngle: 0.2, anticlockwise: false, stroke: "#123456" },
    ])] }));
    const paths = f.root.querySelectorAll('[data-svg-primitive="arc"]');
    assert.equal((paths[0].getAttribute("d")!.match(/A/g) ?? []).length, 2);
    assert.match(paths[1].getAttribute("d")!, /A40 40 0 0 1 /);
  } finally { f.close(); }
});

test("portal echoes apply and clear numeric dash and width independently of old CSS", () => {
  const f = fixture(), renderer = new SvgGraphicsRenderer(f.root);
  try {
    const value = portal();
    value.echo = { ...value.stroke!, width: 1.2, dash: [4, 4] };
    renderer.render(frame({ layers: normalLayers(), masks: [mask()], portal: value }));
    const echo = f.root.querySelector(".portal-echo-stroke")!;
    assert.equal(echo.getAttribute("stroke-dasharray"), "4 4");
    assert.equal(echo.getAttribute("stroke-width"), "1.2");
    renderer.render(frame({ revision: 1, layers: normalLayers(), masks: [mask()], portal: { ...value, echo: undefined } }));
    assert.equal(echo.getAttribute("stroke-dasharray"), null);
    assert.equal(echo.getAttribute("d"), null);
  } finally { renderer.destroy(); f.close(); }
});
