import test from "node:test";
import assert from "node:assert/strict";
import { HoverFeedback } from "../src/core/hover-feedback.ts";
import { Window } from "happy-dom";
import { bindSemanticFeedback } from "../src/rendering/semantic-feedback.ts";

function setup() {
  const window = new Window();
  window.document.body.innerHTML = `<svg><g id="labels"><g class="tag-group" data-command="settings" data-symbol-kind="settings" tabindex="0"><text id="one">设置</text><circle id="two" /></g><g class="tag-group" data-command="next" tabindex="0"><text>下一章</text></g></g><g id="geometry"></g></svg><div id="reading"><button id="a" class="inline-ref" data-target="a1">甲</button><button id="b" class="inline-ref" data-target="a2">乙</button></div>`;
  const states = new Map<
    string,
    { hover: boolean; focus: boolean; press: boolean; active: boolean }
  >();
  const relation = new HoverFeedback();
  const stop = bindSemanticFeedback({
    labels: window.document.querySelector("#labels") as any,
    reading: window.document.querySelector("#reading") as any,
    geometry: window.document.querySelector("#geometry") as any,
    resolve: (key) =>
      key === "settings"
        ? { type: "navigate", target: "act:settings" }
        : { type: "navigate", target: "a1" },
    symbol: (key, patch) =>
      states.set(key, {
        hover: false,
        focus: false,
        press: false,
        active: false,
        ...states.get(key),
        ...patch,
      }),
    hover: (value, channel, previous) => relation.set(value, channel, previous),
  });
  const pointer = (selector: string, type: string, related?: string) =>
    window.document.querySelector(selector)!.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        relatedTarget: related ? window.document.querySelector(related) : null,
      }),
    );
  const focus = (selector: string, type: string) =>
    window.document
      .querySelector(selector)!
      .dispatchEvent(new window.FocusEvent(type, { bubbles: true }));
  return {
    window,
    states,
    pointer,
    focus,
    hovered: () => relation.target,
    externalHover: (value: string | null) => relation.set(value),
    stop,
    close: () => {
      stop();
      window.close();
    },
  };
}

test("pointer cancellation outside labels clears a pressed semantic control", () => {
  const f = setup();
  try {
    f.pointer("#one", "pointerdown");
    assert.equal(f.states.get("settings")?.press, true);
    f.window.document.dispatchEvent(
      new f.window.PointerEvent("pointercancel", { bubbles: true }),
    );
    assert.equal(f.states.get("settings")?.press, false);
  } finally {
    f.close();
  }
});

test("moving within a label keeps its hover and press feedback", () => {
  const f = setup();
  try {
    f.pointer("#one", "pointerover");
    f.pointer("#one", "pointerdown");
    f.pointer("#one", "pointerout", "#two");
    assert.equal(f.states.get("settings")?.hover, true);
    assert.equal(f.states.get("settings")?.press, true);
    f.window.document.dispatchEvent(
      new f.window.PointerEvent("pointerup", { bubbles: true }),
    );
    assert.equal(f.states.get("settings")?.press, false);
  } finally {
    f.close();
  }
});

test("pointer relation feedback restores the independent keyboard focus target", () => {
  const f = setup();
  try {
    f.pointer("#a", "pointerover");
    f.focus("#b", "focusin");
    f.pointer("#a", "pointerover");
    assert.equal(f.hovered(), "a1");
    f.pointer("#a", "pointerout");
    assert.equal(f.hovered(), "a2");
    f.focus("#b", "focusin");
    f.externalHover("hub:C");
    f.window.document.dispatchEvent(
      new f.window.PointerEvent("pointercancel", { bubbles: true }),
    );
    assert.equal(
      f.hovered(),
      "hub:C",
      "cancellation must not replace a later shared CPU target",
    );
    f.focus("#b", "focusout");
    assert.equal(
      f.hovered(),
      "hub:C",
      "DOM focus cleanup must not erase a later shared CPU hit",
    );
  } finally {
    f.close();
  }
});

test("ordinary text labels expose focus feedback and disposal releases owned state", () => {
  const f = setup();
  try {
    f.focus('[data-command="next"]', "focusin");
    assert.equal(f.states.get("next")?.focus, true);
    f.stop();
    assert.equal(f.states.get("next")?.focus, false);
    const state = JSON.stringify([...f.states]);
    f.focus('[data-command="next"]', "focusin");
    assert.equal(JSON.stringify([...f.states]), state);
  } finally {
    f.close();
  }
});
