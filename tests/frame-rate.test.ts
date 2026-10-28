import test from "node:test";
import assert from "node:assert/strict";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import { frameRateLimit } from "../src/core/frame-rate.ts";
import { readFrameRate, saveFrameRate } from "../src/platform/preferences.ts";
test("frame rate choices change scheduling independently of animation speed", () => {
  const field = new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1896,
    height: 1016,
  });
  field.dispatch({ type: "navigate", target: "act:fps120" });
  assert.equal(frameRateLimit(field.state.settings.frameRate, false), 120);
  field.dispatch({ type: "navigate", target: "act:fpsdisplay" });
  assert.equal(frameRateLimit(field.state.settings.frameRate, true), Infinity);
  assert.equal(field.state.settings.speed, 1);
  assert.equal(field.selected().id, "a0");
  field.dispatch({ type: "navigate", target: "act:fpsadaptive" });
  assert.equal(frameRateLimit(field.state.settings.frameRate, false), 24);
  assert.equal(frameRateLimit(field.state.settings.frameRate, true), 60);
});
test("frame rate preference round trips and tolerates blocked or invalid storage", () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  saveFrameRate("display", storage);
  assert.equal(readFrameRate(storage), "display");
  saveFrameRate(120, storage);
  assert.equal(readFrameRate(storage), 120);
  values.set("shuyra.frame-rate", "99999");
  assert.equal(readFrameRate(storage), "adaptive");
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readFrameRate(blocked), "adaptive");
  assert.doesNotThrow(() => saveFrameRate("display", blocked));
});
