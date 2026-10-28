import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import type { FieldAttachment } from "../src/core/attachments.ts";
import {
  LocalLabelTurns,
  LOCAL_LABEL_TURN_MS as duration,
} from "../src/rendering/local-labels.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { Scene } from "../src/rendering/scene.ts";
const item = (chapter: string, index = 0): FieldAttachment => ({
  id: `local:${index}`,
  glyph: chapter,
  aria: chapter,
  scope: "hub",
  role: "local",
  side: "content",
  distance: 22,
  anchor: {
    id: `local:${chapter}:${index}`,
    hostHub: "A",
    parameter: 45 * (index + 1),
  },
  opacity: 1,
  command: { type: "navigate", target: chapter },
  visual: "nav",
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6);

test("local labels open around their material hinge and become interactive only when settled", () => {
  const turns = new LocalLabelTurns(),
    a = item("a");
  let frames = turns.update("a", [a], 0, false);
  assert.equal(frames[0].pose?.angle, 90);
  assert.equal(frames[0].pose?.interactive, false);
  assert.equal(turns.isAnimating, true);
  frames = turns.update("a", [a], duration / 2, false);
  near(frames[0].pose!.squash, Math.SQRT1_2);
  assert.deepEqual(frames[0].attachment.anchor, a.anchor);
  frames = turns.update("a", [a], duration, false);
  assert.equal(frames[0].pose, null);
  assert.equal(frames[0].phase, "settled");
  assert.equal(turns.isAnimating, false);
});

test("scrolling to another ordinary label closes the old local group before opening the new group", () => {
  const turns = new LocalLabelTurns(),
    a = item("a"),
    b = item("b");
  turns.update("a", [a], 0, false);
  turns.update("a", [a], duration, false);
  let frames = turns.update("b", [b], duration, false);
  assert.equal(frames[0].phase, "leaving");
  assert.equal(frames[0].attachment.glyph, "a");
  assert.equal(frames[0].pose?.interactive, false);
  assert.equal(frames[1].visibility, 0);
  frames = turns.update("b", [b], duration * 1.5, false);
  near(frames[0].visibility, 0.5);
  assert.equal(frames[1].visibility, 0);
  frames = turns.update("b", [b], duration * 2.5, false);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].attachment.glyph, "b");
  near(frames[0].visibility, 0.5);
  turns.update("b", [b], duration * 3, false);
  assert.equal(turns.isAnimating, false);
});

test("rapid ordinary scrolling discards unopened groups and reversing preserves the current turn angle", () => {
  const turns = new LocalLabelTurns(),
    a = item("a"),
    b = item("b"),
    c = item("c");
  turns.update("a", [a], 0, false);
  turns.update("a", [a], duration, false);
  turns.update("b", [b], duration, false);
  let frames = turns.update("c", [c], duration * 1.5, false);
  assert.deepEqual(
    frames.map((f) => f.attachment.glyph),
    ["a", "c"],
  );
  const angle = frames[0].pose!.angle;
  frames = turns.update("a", [a], duration * 1.5, false);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].phase, "entering");
  near(frames[0].pose!.angle, angle);
  frames = turns.update("a", [a], duration * 2, false);
  assert.equal(frames[0].phase, "settled");
});

test("scrolling the local band turns only leaves entering or leaving the visible window", () => {
  const turns = new LocalLabelTurns(),
    a = item("a", 0),
    b = item("a", 1),
    c = item("a", 2);
  turns.update("a", [a, b], 0, false);
  turns.update("a", [a, b], duration, false);
  const frames = turns.update("a", [b, c], duration, false);
  assert.equal(
    frames.find((f) => f.attachment.anchor.id === a.anchor.id)?.phase,
    "leaving",
  );
  assert.equal(
    frames.find((f) => f.attachment.anchor.id === b.anchor.id)?.pose,
    null,
  );
  assert.equal(
    frames.find((f) => f.attachment.anchor.id === c.anchor.id)?.phase,
    "entering",
  );
});

test("reduced motion settles current local leaves immediately and clears retired commands", () => {
  const turns = new LocalLabelTurns(),
    a = item("a"),
    b = item("b");
  turns.update("a", [a], 0, false);
  const frames = turns.update("b", [b], duration / 2, true);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].attachment.glyph, "b");
  assert.equal(frames[0].pose, null);
  assert.equal(turns.isAnimating, false);
  assert.deepEqual(turns.update(null, [], duration, true), []);
});

test("ordinary chapter scrolling retains outgoing local DOM and commands until its page exit completes", () => {
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
  });
  const host = window.document.querySelector("#scene")!;
  let now = 0;
  f.dispatch({ type: "navigate", target: "b1" });
  for (; now < 2000; now += 20) f.update(now, 20);
  const scene = new Scene(host as unknown as HTMLElement, f.catalog);
  const tick = (ms: number) => {
    for (let i = 0; i < ms; i += 20) {
      f.update((now += 20), 20);
      scene.render(f.state);
    }
  };
  try {
    scene.render(f.state);
    tick(duration);
    const oldKey = "B:local:b1:1",
      nextKey = "B:local:b2:1";
    const old = host.querySelector(`[data-command="${oldKey}"]`)!;
    const oldGlyph = old.textContent;
    assert.ok(scene.actions.has(oldKey));
    f.dispatch({ type: "step", delta: 1 });
    scene.render(f.state);
    assert.equal(f.selected().id, "b2");
    assert.equal(f.state.contentTurn, null);
    assert.equal(f.state.morphTurn, null);
    assert.equal(old.getAttribute("data-local-phase"), "leaving");
    assert.equal(
      old.textContent,
      oldGlyph,
      "outgoing refs are not overwritten by the new chapter's refs",
    );
    assert.equal(old.getAttribute("aria-hidden"), "true");
    assert.equal(scene.actions.has(oldKey), false);
    assert.equal(scene.actions.has(nextKey), false);
    assert.equal(
      host
        .querySelector('[data-command="B:b2"]')!
        .classList.contains("turning"),
      false,
    );
    assert.ok(
      [...host.querySelectorAll('[data-role="operation"]')].every(
        (e) => !e.classList.contains("turning"),
      ),
    );
    tick(duration / 2);
    assert.notEqual((old as unknown as HTMLElement).style.display, "none");
    tick(duration / 2);
    assert.equal((old as unknown as HTMLElement).style.display, "none");
    tick(duration);
    assert.ok(scene.actions.has(nextKey));
    assert.equal(scene.actions.has(oldKey), false);
    assert.equal(scene.isAnimating, false);
  } finally {
    scene.destroy();
    window.close();
    Object.assign(globalThis, { document: saved });
  }
});
