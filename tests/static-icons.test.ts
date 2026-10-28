import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { ICON_TOKENS } from "../src/core/icons.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import { Scene } from "../src/rendering/scene.ts";
test("static icon mapping matches the nine user selections", () => {
  const wanted = {
    "⊙": "circle-dot",
    "⌕": "search",
    "⚙": "settings",
    "↶": "corner-up-left",
    "◌": "loader-circle",
    "↑": "corner-left-up",
    "⌖": "scan",
    "✓": "check",
    "✕": "x",
  };
  for (const [glyph, name] of Object.entries(wanted)) {
    assert.equal(ICON_TOKENS[glyph].iconName, name);
    assert.ok(ICON_TOKENS[glyph].shapes.length > 0);
  }
});
test("rendered icon paths stay identical during hub morph and hover while labels retain their own animation", () => {
  const window = new Window(),
    saved = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[^>]*>[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const f = new Field(new Catalog(hubDefinitions, rawContent), {
      width: 1280,
      height: 800,
    }),
    host = window.document.querySelector("#scene")!,
    scene = new Scene(host as unknown as HTMLElement, f.catalog);
  try {
    scene.render(f.state);
    const glyph = host.querySelector(
        '[data-command="A:global:settings"] .label-icon-glyph',
      )!,
      shape = glyph.innerHTML;
    f.dispatch({ type: "morph" });
    for (const now of [100, 300, 500, 700, 900]) {
      f.update(now, 20);
      scene.render(f.state);
      assert.equal(glyph.innerHTML, shape);
    }
    scene.setSymbolInteraction("A:global:settings", {
      hover: true,
      press: true,
    });
    assert.equal(glyph.innerHTML, shape);
    assert.equal(
      host
        .querySelector('[data-command="A:global:settings"]')!
        .getAttribute("data-icon"),
      "settings",
    );
    assert.ok(host.querySelector('#hudControls svg[stroke="currentColor"]'));
  } finally {
    scene.destroy();
    window.close();
    Object.assign(globalThis, { document: saved });
  }
});
