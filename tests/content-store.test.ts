import test from "node:test";
import assert from "node:assert/strict";
import type {
  ContentSource,
  Presentation,
  TextPatch,
} from "../src/core/content.ts";
import { ContentStore } from "../src/content/store.ts";

class Channel {
  private readonly queue: TextPatch[] = [];
  private readonly waiters: {
    resolve: (value: IteratorResult<TextPatch>) => void;
    reject: (error: unknown) => void;
  }[] = [];
  private terminal: { done: true } | { error: unknown } | null = null;

  push(patch: TextPatch) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: patch });
    else this.queue.push(patch);
  }

  finish() {
    this.terminal = { done: true };
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({ done: true, value: undefined });
  }

  fail(error: unknown) {
    this.terminal = { error };
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next(): Promise<IteratorResult<TextPatch>> {
    const patch = this.queue.shift();
    if (patch) return Promise.resolve({ done: false, value: patch });
    if (this.terminal && "error" in this.terminal)
      return Promise.reject(this.terminal.error);
    if (this.terminal) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
  }
}

class ChannelSource implements ContentSource {
  readonly channels: Channel[] = [];
  open(_id: string, _presentation: Presentation, signal: AbortSignal) {
    const channel = new Channel();
    this.channels.push(channel);
    signal.addEventListener("abort", () => channel.finish(), { once: true });
    return { [Symbol.asyncIterator]: () => channel };
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("ready covers the first committed batch and flush returns each change", async () => {
  const source = new ChannelSource();
  const store = new ContentStore(source);
  const request = store.start("a0", "circle");
  await tick();
  source.channels[0].push({ type: "append", text: "one" });
  await request.ready;
  let state = store.get("a0", "circle");
  assert.equal(state.text, "one");
  assert.equal(state.version, 1);
  assert.equal(state.status, "streaming");
  assert.equal(state.complete, false);
  const first = store.flush();
  assert.ok(Array.isArray(first));
  assert.equal(first.changes, first);
  assert.equal(first.length, 1);
  assert.equal(first[0].text, "one");

  source.channels[0].push({ type: "append", text: " two" });
  await tick();
  assert.equal(store.get("a0", "circle").text, "one");
  const second = store.flush();
  assert.equal(second.length, 1);
  assert.equal(second[0].text, "one two");
  assert.equal(second[0].version, 2);

  source.channels[0].finish();
  await request.done;
  state = store.get("a0", "circle");
  assert.equal(state.complete, true);
  assert.equal(state.status, "complete");
  const last = store.flush();
  assert.equal(last.length, 1);
  assert.equal(last[0].complete, true);
});

test("replace patches replace the accumulated text", async () => {
  const source = new ChannelSource();
  const store = new ContentStore(source);
  const request = store.start("a1", "line");
  await tick();
  source.channels[0].push({ type: "append", text: "old" });
  await request.ready;
  store.flush();
  source.channels[0].push({ type: "replace", text: "new" });
  await tick();
  const changes = store.flush();
  assert.equal(changes[0].text, "new");
  assert.equal(store.get("a1", "line").text, "new");
  source.channels[0].finish();
  await request.done;
});

test("an empty stream still resolves ready and completes", async () => {
  const source = new ChannelSource();
  const store = new ContentStore(source);
  const request = store.start("empty", "circle");
  await tick();
  source.channels[0].finish();
  await request.ready;
  await request.done;
  const state = store.get("empty", "circle");
  assert.equal(state.text, "");
  assert.equal(state.complete, true);
  assert.equal(state.status, "complete");
  assert.equal(state.version, 1);
});

test("cancel stops late patches and settles both promises", async () => {
  const source = new ChannelSource();
  const store = new ContentStore(source);
  const request = store.start("a2", "circle");
  await tick();
  source.channels[0].push({ type: "append", text: "kept" });
  await request.ready;
  store.flush();
  request.cancel();
  await request.done;
  source.channels[0].push({ type: "append", text: " late" });
  await tick();
  const state = store.get("a2", "circle");
  assert.equal(state.text, "kept");
  assert.equal(state.status, "cancelled");
  assert.equal(state.complete, false);
});

test("a new generation cannot be polluted by an older stream", async () => {
  const source = new ChannelSource();
  const store = new ContentStore(source);
  const first = store.start("a3", "circle");
  await tick();
  source.channels[0].push({ type: "append", text: "old" });
  await first.ready;
  const second = store.start("a3", "circle");
  await first.done;
  await tick();
  source.channels[0].push({ type: "append", text: "-late" });
  source.channels[1].push({ type: "append", text: "new" });
  await second.ready;
  assert.equal(store.get("a3", "circle").text, "new");
  source.channels[1].finish();
  await second.done;
});

test("source rejection rejects done without an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const handler = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", handler);
  try {
    const source = new ChannelSource();
    const store = new ContentStore(source);
    const request = store.start("bad", "line");
    await tick();
    source.channels[0].fail(new Error("stream failed"));
    await request.ready;
    await assert.rejects(request.done, /stream failed/);
    await tick();
    const state = store.get("bad", "line");
    assert.equal(state.status, "error");
    assert.match(state.error?.message ?? "", /stream failed/);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", handler);
  }
});

test("unknown requests report idle and flush stays empty", () => {
  const store = new ContentStore(new ChannelSource());
  assert.deepEqual(store.get("missing", "circle"), {
    text: "",
    version: 0,
    complete: false,
    status: "idle",
    error: null,
  });
  assert.equal(store.flush().length, 0);
});
