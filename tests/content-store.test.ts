import test from "node:test";
import assert from "node:assert/strict";
import type {
  ContentSource,
  Presentation,
  TextPatch,
} from "../src/core/content.ts";
import { ContentStore } from "../src/content/store.ts";
import { createContentRuntime } from "../src/content/runtime.ts";

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

test("start does not erase published text and a request has its own network version", async () => {
  const source = new ChannelSource();
  const store = new ContentStore(source);
  assert.deepEqual(store.expression("a4", "circle"), {
    text: "",
    version: 0,
    complete: false,
  });
  assert.equal(store.publish("a4", "circle", "published", true), true);
  assert.equal(store.publish("a4", "circle", "published", true), false);
  const published = { text: "published", version: 1, complete: true };
  assert.deepEqual({ ...store.expression("a4", "circle") }, published);

  const request = store.start("a4", "circle");
  assert.deepEqual(store.expression("a4", "circle"), published);
  assert.deepEqual(store.get("a4", "circle"), {
    text: "",
    version: 0,
    complete: false,
    status: "loading",
    error: null,
  });
  await tick();
  source.channels[0].push({ type: "append", text: "net" });
  await request.ready;
  assert.deepEqual(store.expression("a4", "circle"), published);
  assert.equal(store.get("a4", "circle").version, 1);
  assert.equal(store.flush()[0].version, 1);
  assert.deepEqual(store.expression("a4", "circle"), published);

  store.publish("a4", "circle", "published!", false);
  assert.deepEqual(store.expression("a4", "circle"), {
    text: "published!",
    version: 2,
    complete: false,
  });
  source.channels[0].finish();
  await request.done;
  // The new stream's late changes are visible, not cleared by the request.
  assert.equal(store.get("a4", "circle").version, 2);
  assert.equal(store.expression("a4", "circle").version, 2);
});

test("publish keeps stable paragraph objects across incremental updates", () => {
  const store = new ContentStore();
  const first = "第一段 {标签|b0}\n\n第二段开始";
  assert.equal(store.publish("p0", "line", first, false), true);
  const document = store.document("p0", "line");
  assert.equal(store.document("p0", "line"), document);
  assert.equal(document.blocks.length, 2);

  let next = first;
  for (let step = 0; step < 4; step++) {
    next += `，第${step}次补充`;
    assert.equal(store.publish("p0", "line", next, false), true);
  }
  const grown = store.document("p0", "line");
  assert.notEqual(grown, document);
  assert.equal(grown.blocks[0], document.blocks[0]);
  assert.equal(grown.blocks[0].inline, document.blocks[0].inline);
  assert.equal(grown.blocks[1].sourceEnd, next.length);
  assert.equal(store.expression("p0", "line").version, 5);
  assert.equal(store.publish("p0", "line", next, false), false);
  assert.equal(store.expression("p0", "line").version, 5);

  assert.equal(store.publish("p0", "line", next, true), true);
  const complete = store.document("p0", "line");
  assert.equal(complete.complete, true);
  assert.ok(complete.blocks.every(block => block.stable), "EOF must stabilize the last block even when no new characters arrive");
  assert.equal(complete.blocks[0], document.blocks[0]);
  assert.ok(complete.blocks[1].inline.every((item) => item.type !== "reference"));
  assert.equal(store.expression("p0", "line").version, 6);

  assert.equal(store.publish("p0", "line", `${next}\n\n收尾`, true), true);
  const finished = store.document("p0", "line");
  assert.equal(finished.blocks[0], document.blocks[0]);
  assert.equal(finished.blocks[1].stable, true);
  assert.equal(finished.blocks.length, 3);
  assert.ok(finished.blocks.every((block) => block.stable));
});

test("seed only initializes missing published text", () => {
  const store = new ContentStore();
  assert.deepEqual(store.document("s0", "circle"), store.document("s0", "circle"));
  store.publish("s0", "circle", "owned", true);
  store.seed("s0", "circle", "authored", true);
  store.seed("s0", "line", "authored", true);
  assert.deepEqual(store.expression("s0", "circle"), {
    text: "owned",
    version: 1,
    complete: true,
  });
  assert.deepEqual(store.expression("s0", "line"), {
    text: "authored",
    version: 1,
    complete: true,
  });
  store.seed("s1", "circle", "", false);
  assert.deepEqual(store.expression("s1", "circle"), {
    text: "",
    version: 0,
    complete: false,
  });
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


test("runtime never publishes a chunk cancelled before its host flush", async () => {
  const runtime = createContentRuntime();
  runtime.catalog.updateExpression("a0", "circle", "保留的正文", true);
  runtime.source.open = async function* () {
    yield { type: "replace", text: "取消的正文" };
    await new Promise<void>(() => {});
  };
  const request = runtime.start("a0", "circle");
  await request.ready;
  request.cancel();
  await request.done;
  assert.equal(runtime.store.get("a0", "circle").status, "cancelled");
  assert.equal(runtime.store.get("a0", "circle").complete, false);
  runtime.flush();
  assert.equal(runtime.catalog.get("a0").expressions.circle, "保留的正文");
  assert.equal(runtime.store.expression("a0", "circle").text, "保留的正文");
});
