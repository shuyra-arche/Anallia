import test from "node:test";
import assert from "node:assert/strict";
import { startClock } from "../src/platform/clock.ts";
test("clock caps high refresh displays and pauses completely in background", () => {
  const saved = {
    document: globalThis.document,
    request: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
  };
  const document = Object.assign(new EventTarget(), { hidden: false });
  const queue = new Map<number, FrameRequestCallback>();
  let id = 0;
  Object.assign(globalThis, {
    document,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      queue.set(++id, callback);
      return id;
    },
    cancelAnimationFrame: (key: number) => queue.delete(key),
  });
  let count = 0,
    rate = 24,
    now = performance.now();
  const stop = startClock(
    () => count++,
    () => rate,
  );
  const run = (frames: number, hz = 144) => {
    for (let i = 0; i < frames; i++) {
      now += 1000 / hz;
      const [key, callback] = queue.entries().next().value!;
      queue.delete(key);
      callback(now);
    }
  };
  try {
    run(144);
    assert.ok(count >= 23 && count <= 25, `${count} idle updates`);
    count = 0;
    rate = 60;
    run(144);
    assert.ok(count >= 56 && count <= 61, `${count} active updates`);
    count = 0;
    rate = Infinity;
    run(240, 240);
    assert.equal(count, 240, "display mode updates on every refresh at 240Hz");
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(queue.size, 0);
    document.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(queue.size, 1);
    stop();
    assert.equal(queue.size, 0);
  } finally {
    stop();
    Object.assign(globalThis, {
      document: saved.document,
      requestAnimationFrame: saved.request,
      cancelAnimationFrame: saved.cancel,
    });
  }
});
