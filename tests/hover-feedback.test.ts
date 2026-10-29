import test from "node:test";
import assert from "node:assert/strict";
import { HoverFeedback } from "../src/core/hover-feedback.ts";

test("relation feedback restores the other active input and protects newer CPU hits", () => {
  const value = new HoverFeedback();
  value.set("a1", "pointer");
  value.set("a2", "focus");
  assert.equal(value.target, "a2");
  value.set("a1", "pointer");
  value.set(null, "pointer", "a1");
  assert.equal(value.target, "a2");
  value.set("hub:C", "pointer");
  value.set(null, "pointer", "a1");
  assert.equal(value.target, "hub:C");
  value.set(null, "focus", "a2");
  assert.equal(value.target, "hub:C");
  value.set(null, "pointer");
  assert.equal(value.target, null);
  value.set("a3", "focus");
  value.clear();
  assert.equal(value.target, null);
});
