import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { evaluateLabel, labelHitRegion } from "../src/geometry/labels.ts";
import type { LabelInput } from "../src/geometry/labels.ts";
import { SemanticLabels } from "../src/rendering/semantic-labels.ts";

const input = (): LabelInput => ({
  hubId: "A",
  key: "local:a2",
  name: "阅读",
  at: { x: 200, y: 100 },
  anchor: { x: 100, y: 50 },
  kind: "current",
  degree: 225,
  zoom: 2,
  command: { type: "navigate", target: "a2" },
  aria: "继续阅读",
  alpha: 1,
  page: null,
  interaction: { hover: false, focus: false, press: false, active: false },
  activity: 0,
});

test("numeric labels preserve one zoom and snapshot positions independently of DOM", () => {
  const source = input();
  const label = evaluateLabel(source);
  assert.deepEqual(label.layout.offset, { x: 50, y: 25 });
  assert.equal(label.layout.degree, 45);
  const hit = labelHitRegion(label)!;
  assert.equal(hit.localScrollHub, "A");
  assert.equal(hit.shape.type, "rect");
  if (hit.shape.type === "rect") {
    assert.equal(hit.shape.width, label.layout.width * 2);
    assert.equal(hit.shape.height, 88);
    assert.equal(hit.shape.x, 200);
  }
  source.at.x = 999;
  source.anchor.y = 999;
  source.interaction!.hover = true;
  assert.equal(label.layout.position.x, 200);
  assert.equal(label.layout.hinge.y, 50);
  assert.equal(label.interaction!.hover, false);
  const turned = evaluateLabel({
    ...input(),
    page: {
      angle: 180,
      squash: 0.001,
      opacity: 0,
      incoming: true,
      interactive: false,
    },
  });
  assert.equal(labelHitRegion(turned), null);
});

test("semantic proxies consume numeric frames and preserve the focused node across updates", () => {
  const window = new Window();
  const previous = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  try {
    const root = window.document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    window.document.body.append(root);
    const layer = new SemanticLabels(root as unknown as SVGGElement);
    const frame = evaluateLabel(input());
    layer.render([frame]);
    const proxy = root.querySelector("[data-command]")!;
    (proxy as unknown as HTMLElement).focus();
    layer.render([
      {
        ...frame,
        glyph: "更新",
        localPhase: "entering",
        resonating: true,
        layout: { ...frame.layout, hinge: { x: 250, y: 120 } },
      },
    ]);
    assert.ok(root.querySelector("[data-command]") === proxy);
    assert.ok(window.document.activeElement === proxy);
    assert.equal(proxy.getAttribute("aria-label"), "继续阅读");
    assert.equal(
      proxy.getAttribute("transform"),
      "translate(250 120) scale(2)",
    );
    assert.equal(proxy.getAttribute("data-local-phase"), "entering");
    assert.equal(proxy.classList.contains("is-resonating-ref"), true);
    layer.render([]);
    assert.equal((proxy as unknown as HTMLElement).style.display, "none");
    layer.destroy();
    assert.equal(root.children.length, 0);
  } finally {
    window.close();
    Object.assign(globalThis, { document: previous });
  }
});
