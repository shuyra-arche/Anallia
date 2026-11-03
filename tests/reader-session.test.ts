import test from "node:test";
import assert from "node:assert/strict";
import { parseContent } from "../src/content/parser.ts";
import { captureSessionAnchor, resolveSessionAnchor, readReaderSnapshot, initialReaderSnapshot } from "../src/core/reader-snapshot.ts";
import { ReaderObservation } from "../src/core/reader-observation.ts";
import { createFieldNotebook } from "../src/examples/field-notebook.ts";
import type { ReaderState } from "../src/core/reader.ts";

test("portable anchors follow a unique exact block through insertions without serializing pixels", () => {
  const source = parseContent("前言。\n\n唯一段落，正在读这里。\n\n结尾。");
  const anchor = captureSessionAnchor(source, source.source.indexOf("正在"))!;
  const target = parseContent("新增的前言。\n\n另一段。\n\n唯一段落，正在读这里。\n\n结尾。");
  assert.deepEqual(Object.keys(anchor), ["kind", "text", "offset"]);
  assert.equal(resolveSessionAnchor(JSON.parse(JSON.stringify(anchor)), target), target.source.indexOf("正在"));
  assert.equal(resolveSessionAnchor(anchor, parseContent("唯一段落，已经改写。")), null);
});

test("session anchors reject ambiguous, incomplete, oversized and invalid source positions", () => {
  assert.equal(captureSessionAnchor(parseContent("重复。\n\n重复。"), 1), null);
  assert.equal(captureSessionAnchor(parseContent("还在接收。", false), 1), null);
  assert.equal(captureSessionAnchor(parseContent("长".repeat(65537)), 5), null);
  const doc = parseContent("完整段落。");
  for (const source of [-1, 0.5, Infinity, 100]) assert.equal(captureSessionAnchor(doc, source), null);
  const anchor = captureSessionAnchor(doc, 1)!;
  assert.equal(resolveSessionAnchor(anchor, parseContent("完整段落。\n\n完整段落。")), null);
  assert.equal(resolveSessionAnchor(anchor, parseContent("完整段落。", false)), null);
});

test("snapshot validation rejects wrong versions, malformed anchors and foreign locations before mounting", () => {
  const definition = createFieldNotebook();
  const valid = { version: 1, location: { hub: "OBS", chapter: "obs-start", presentation: "circle" }, anchor: null };
  const result = readReaderSnapshot(valid, definition);
  valid.location.chapter = "mutated";
  assert.equal(result.location.chapter, "obs-start");
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.location));
  for (const value of [null, {}, { ...result, version: 2 }, { ...result, anchor: undefined },
    { ...result, location: { ...result.location, chapter: "a0" } },
    { ...result, location: { ...result.location, hub: "LOG" } },
    { ...result, location: { ...result.location, presentation: "half" } },
    { ...result, anchor: { kind: "paragraph", text: "abc", offset: 3 } },
    { ...result, anchor: { kind: "unknown", text: "abc", offset: 1 } }]) {
    assert.throws(() => readReaderSnapshot(value, definition), /Invalid reader snapshot/);
  }
  assert.throws(() => initialReaderSnapshot(definition, { restore: result, chapter: "obs-start" }), /cannot be combined/);
  assert.throws(() => initialReaderSnapshot(definition, { restore: result, morph: 0 }), /cannot be combined/);
});

const active = (): ReaderState => ({ status: "active", location: { hub: "OBS", chapter: "obs-start", presentation: "circle" },
  view: "reading", readable: true, motion: "idle", content: "complete", request: null, restoration: "none" });

test("subscriptions detach immutable state, deduplicate frames and remove duplicate registrations independently", () => {
  const channel = new ReaderObservation();
  const events: ReaderState[] = [];
  const callback = (state: ReaderState) => events.push(state);
  const first = channel.subscribe(callback), second = channel.subscribe(callback);
  const state = active(); channel.publish(state); channel.publish(active());
  assert.equal(events.length, 4);
  assert.ok(Object.isFrozen(events[2]));
  if (state.status === "active") (state.location as any).chapter = "mutated";
  assert.equal((channel.getState() as any).location.chapter, "obs-start");
  assert.throws(() => { (channel.getState() as any).location.chapter = "bad"; }, TypeError);
  first(); first(); channel.publish({ status: "destroyed" });
  assert.equal(events.length, 5); second(); channel.publish(active());
  assert.equal(channel.getState().status, "destroyed");
  channel.subscribe(callback)(); assert.equal(events.at(-1)?.status, "destroyed");
});

test("reentrant destroy never delivers stale active states after the terminal event", () => {
  const channel = new ReaderObservation(), events: string[] = [];
  channel.subscribe(state => { if (state.status === "active") channel.publish({ status: "destroyed" }); });
  channel.subscribe(state => events.push(state.status));
  channel.publish(active());
  assert.deepEqual(events, ["starting", "destroyed"]);
});

test("a failing subscriber does not block other listeners or the reader", () => {
  const channel = new ReaderObservation(), events: string[] = [];
  const original = console.error, errors: unknown[] = [];
  console.error = (...args) => { errors.push(args); };
  try {
    channel.subscribe(() => { throw new Error("consumer failure"); });
    channel.subscribe(state => events.push(state.status));
    channel.publish(active()); channel.publish({ status: "destroyed" });
  } finally { console.error = original; }
  assert.equal(errors.length, 3);
  assert.deepEqual(events, ["starting", "active", "destroyed"]);
});
