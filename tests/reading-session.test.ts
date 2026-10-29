import test from "node:test";
import assert from "node:assert/strict";
import type { ContentSource, TextPatch, Presentation } from "../src/core/content.ts";
import { ContentStore } from "../src/content/store.ts";
import { contentManifest } from "../src/content/generated/manifest.ts";
import { Catalog } from "../src/content/catalog.ts";
import { Field } from "../src/application/field.ts";
import { ReadingSession } from "../src/application/reading-session.ts";

class Channel implements AsyncIterator<TextPatch> {
  private queue: TextPatch[] = [];
  private waiter: { resolve: (value: IteratorResult<TextPatch>) => void; reject: (error: Error) => void } | null = null;
  private terminal: Error | true | null = null;
  push(text: string, type: TextPatch["type"] = "append") {
    if (this.waiter) { this.waiter.resolve({ done: false, value: { type, text } }); this.waiter = null; }
    else this.queue.push({ type, text });
  }
  finish(error?: Error) {
    this.terminal = error ?? true;
    if (error) this.waiter?.reject(error);
    else this.waiter?.resolve({ done: true, value: undefined });
    this.waiter = null;
  }
  next(): Promise<IteratorResult<TextPatch>> {
    const value = this.queue.shift();
    if (value) return Promise.resolve({ done: false, value });
    if (this.terminal instanceof Error) return Promise.reject(this.terminal);
    if (this.terminal) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }
}
class Source implements ContentSource {
  held = new Set<string>();
  channels = new Map<string, Channel[]>();
  open(id: string, presentation: Presentation) {
    const key = `${id}:${presentation}`;
    if (!this.held.has(key)) return (async function* () { yield { type: "replace" as const, text: `${id} initial body` }; })();
    const channel = new Channel();
    this.channels.set(key, [...(this.channels.get(key) ?? []), channel]);
    return { [Symbol.asyncIterator]: () => channel };
  }
  latest(id: string, presentation: Presentation = "circle") { return this.channels.get(`${id}:${presentation}`)!.at(-1)!; }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  const source = new Source();
  const store = new ContentStore(source);
  const field = new Field(new Catalog(contentManifest.definitions, contentManifest), { width: 1366, height: 820 }, true);
  const reading = new ReadingSession(field, store);
  async function frame(now: number) {
    await tick();
    reading.flush(now);
    field.update(now, 20);
    reading.afterRender((id, presentation) => id === field.selected().id && presentation === (field.hub.morph > 0.5 ? "line" : "circle"));
  }
  return { source, store, field, reading, frame };
}

test("first readable and stream completion are separate barriers, with backend readiness required for boot", async () => {
  const { source, field, reading, frame } = setup();
  source.held.add("a0:circle");
  let backendReady!: () => void;
  reading.startup("a0", new Promise(resolve => { backendReady = resolve; }));
  try {
    await tick();
    source.latest("a0").push("首批正文");
    await frame(20);
    assert.equal(reading.bootReady, false);
    backendReady();
    await frame(40);
    assert.equal(reading.bootReady, true);
    await reading.ready;
    await frame(200);
    assert.equal(reading.activeTask?.firstReadable, true);
    assert.equal(reading.activeTask?.streaming, true);
    const camera = { ...field.state.camera };
    source.latest("a0").push("继续到达");
    await frame(220);
    assert.deepEqual(field.state.camera, camera);
    assert.equal(field.catalog.get("a0").expressions.circle, "首批正文继续到达");
    source.latest("a0").finish();
    await frame(240);
    assert.equal(reading.activeTask?.outcome, "complete");
    await frame(450);
    assert.equal(reading.activeTask, null);
  } finally { reading.destroy(); }
});

test("slow navigation keeps current reading; cancellation rejects stale chunks and a new request can succeed", async () => {
  const { source, store, field, reading, frame } = setup();
  reading.startup("a0", Promise.resolve());
  await frame(20);
  field.state.hubs.M.morph = field.state.hubs.M.targetMorph = 0;
  source.held.add("m3:circle");
  try {
    field.dispatch({ type: "navigate", target: "m3" });
    await frame(200);
    const stale = source.latest("m3");
    assert.equal(field.selected().id, "a0");
    assert.equal(reading.activeTask?.phase, "waiting");
    const camera = { ...field.state.camera };
    assert.equal(reading.cancel(), true);
    stale.push("过期正文");
    await frame(220);
    assert.equal(store.get("m3", "circle").status, "cancelled");
    assert.equal(field.selected().id, "a0");
    assert.deepEqual(field.state.camera, camera);
    field.dispatch({ type: "navigate", target: "m3" });
    await tick();
    source.latest("m3").push("新的正文");
    await frame(260);
    assert.equal(field.selected().id, "m3");
    source.latest("m3").finish();
    await frame(280);
    assert.equal(field.catalog.get("m3").expressions.circle, "新的正文");
  } finally { reading.destroy(); }
});

test("refresh keeps the old body on failure and explicit retry replaces it without treating failure as success", async () => {
  const { source, field, reading, frame } = setup();
  reading.startup("a0", Promise.resolve());
  await frame(20);
  source.held.add("a0:circle");
  try {
    const old = field.catalog.get("a0").expressions.circle;
    reading.refresh();
    await frame(200);
    assert.equal(field.catalog.get("a0").expressions.circle, old);
    source.latest("a0").finish(new Error("offline"));
    await frame(220);
    assert.equal(field.catalog.get("a0").expressions.circle, old);
    assert.equal(reading.error?.chapterId, "a0");
    assert.equal(reading.activeTask?.succeeded, false);
    field.dispatch({ type: "navigate", target: "act:retry_content" });
    await tick();
    source.latest("a0").push("重试正文", "replace");
    source.latest("a0").finish();
    await frame(250);
    assert.equal(reading.error, null);
    assert.equal(field.catalog.get("a0").expressions.circle, "重试正文");
  } finally { reading.destroy(); }
});

test("a failed expression switch retries the failed presentation and its original morph intent", async () => {
  const { source, field, reading, frame } = setup();
  source.held.add("a0:line");
  reading.startup("a0", Promise.resolve());
  await frame(20);
  try {
    field.dispatch({ type: "morph" });
    await frame(200);
    source.latest("a0", "line").finish(new Error("line offline"));
    await frame(220);
    assert.equal(reading.error?.presentation, "line");
    assert.equal(field.hub.targetMorph, 0);
    field.dispatch({ type: "navigate", target: "act:retry_content" });
    await tick();
    source.latest("a0", "line").push("线表达", "replace");
    source.latest("a0", "line").finish();
    await frame(250);
    assert.equal(field.hub.targetMorph, 1);
    assert.equal(field.catalog.get("a0").expressions.line, "线表达");
  } finally { reading.destroy(); }
});

test("new cached navigation clears an error attached to the old chapter", async () => {
  const { source, store, field, reading, frame } = setup();
  reading.startup("a0", Promise.resolve());
  await frame(20);
  await store.start("a1", "circle").done;
  reading.flush(30);
  source.held.add("a0:circle");
  try {
    reading.refresh();
    await tick();
    source.latest("a0").finish(new Error("offline"));
    await frame(200);
    assert.ok(reading.error);
    field.dispatch({ type: "navigate", target: "a1" });
    await frame(220);
    assert.equal(reading.error, null);
    assert.equal(field.selected().id, "a1");
  } finally { reading.destroy(); }
});


test("history return reopens a cancelled partial body without consuming history before it is readable", async () => {
  const { source, field, reading, frame } = setup();
  source.held.add("a0:circle");
  reading.startup("a0", Promise.resolve());
  await tick();
  source.latest("a0").push("先前可读的正文");
  await frame(20);
  await frame(40);
  try {
    field.dispatch({ type: "navigate", target: "a1" });
    await frame(60);
    assert.equal(field.selected().id, "a1");
    const historyLength = field.state.history.length;
    field.dispatch({ type: "back" });
    await frame(220);
    assert.equal(field.selected().id, "a1");
    assert.equal(field.state.history.length, historyLength);
    source.latest("a0").push("重新订阅的正文", "replace");
    source.latest("a0").finish();
    await frame(240);
    assert.equal(field.selected().id, "a0");
    assert.equal(field.state.history.length, historyLength - 1);
    assert.equal(field.catalog.get("a0").expressions.circle, "重新订阅的正文");
  } finally { reading.destroy(); }
});
