import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { ArticleRenderer } from "../src/rendering/article.ts";

test("search mirrors share body documents and retain a focused origin button across streaming", () => {
  const window = new Window(), previous = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  try {
    const catalog = new Catalog(hubDefinitions, rawContent), field = new Field(catalog, { width: 1366, height: 820 });
    catalog.updateExpression("a1", "circle", "稳定首段\n\n末段", false);
    const mirror = catalog.get("q_hit_a1"), article = window.document.createElement("article") as unknown as HTMLElement;
    window.document.body.append(article as any);
    const renderer = new ArticleRenderer(catalog, { inlineIcon: () => window.document.createElementNS("http://www.w3.org/2000/svg", "svg") as any, iconShowcase: () => window.document.createElement("div") as any });
    renderer.fillArticle(article, mirror, field.state.hubs.Q, "circle");
    assert.equal(catalog.sourceChapterId("q_hit_a1"), "a1");
    assert.ok(catalog.document("q_hit_a1", "circle") === catalog.document("a1", "circle"));
    assert.equal(catalog.document("q_hit_a1", "circle").source, "稳定首段\n\n末段");
    const button = article.querySelector<HTMLButtonElement>(".mirror-origin button")!, paragraph = article.querySelector("p")!;
    assert.equal(button.dataset.target, "a1");
    assert.ok(button.textContent!.includes("原枢阅读"));
    button.focus();
    catalog.updateExpression("a1", "circle", "稳定首段\n\n末段继续", false);
    renderer.syncArticle(article, mirror, field.state.hubs.Q, "circle");
    assert.ok(article.querySelector(".mirror-origin button") === button);
    assert.ok(article.querySelector("p") === paragraph);
    assert.ok(window.document.activeElement === button);
    assert.ok(catalog.document("q_hit_a1", "circle") === catalog.document("a1", "circle"));
    renderer.syncArticle(article, catalog.get("a1"), field.state.hubs.A, "circle");
    assert.equal(article.querySelector(".mirror-origin"), null);
  } finally { window.close(); Object.assign(globalThis, { document: previous }); }
});
