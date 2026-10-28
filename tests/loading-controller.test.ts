import test from "node:test";
import assert from "node:assert/strict";
import {
  LOADING_EXIT_MS,
  LOADING_SHOW_DELAY_MS,
  LoadController,
} from "../src/core/loading.ts";
import { LoadController as ApplicationLoadController } from "../src/application/loading.ts";

const task = (id = "task") => ({
  id,
  scope: "local",
  hubId: "hub",
  cancellable: true,
});

test("the 150ms gate hides short tasks and the application re-export is the controller", () => {
  assert.equal(ApplicationLoadController, LoadController);
  const controller = new LoadController();
  assert.equal(controller.update(0, false), null);
  assert.equal(controller.start(task(), 1000), null);
  assert.equal(
    controller.update(1000 + LOADING_SHOW_DELAY_MS - 1, false),
    null,
  );
  const shown = controller.update(1000 + LOADING_SHOW_DELAY_MS, false);
  assert.ok(shown);
  assert.equal(shown.phase, "waiting");
  assert.equal(shown.visibleFor, 0);
  assert.equal(shown.poseTime, 0);
  assert.equal(shown.firstReadable, false);
  assert.equal(shown.streaming, false);
  assert.equal(shown.outcome, null);
  assert.equal(shown.succeeded, false);

  const early = new LoadController();
  early.start(task("early"), 0);
  assert.equal(early.complete("early", 100), null);
  assert.equal(early.update(5000, false), null);
});

test("first readable, local streaming and completion stay separate", () => {
  const controller = new LoadController();
  controller.start(task("stream"), 0);
  controller.update(200, false);

  const first = controller.readable("stream", 300);
  assert.ok(first);
  assert.equal(first.phase, "readable");
  assert.equal(first.firstReadable, true);
  assert.equal(first.streaming, true);
  assert.equal(first.outcome, null);

  const second = controller.readable("stream", 400);
  assert.ok(second);
  assert.equal(second.phase, "streaming");
  assert.equal(second.streaming, true);
  assert.equal(second.succeeded, false);

  const later = controller.update(60000, false);
  assert.ok(later, "animation cycles must not complete a real task");
  assert.equal(later.phase, "streaming");
  assert.equal(later.outcome, null);

  const completeAt = 61000;
  const leaving = controller.complete("stream", completeAt);
  assert.ok(leaving);
  assert.equal(leaving.phase, "leaving");
  assert.equal(leaving.outcome, "complete");
  assert.equal(leaving.succeeded, true);
  assert.equal(leaving.exit, 0);
  const frozen = leaving.poseTime;

  const halfway = controller.update(completeAt + LOADING_EXIT_MS / 2, false);
  assert.ok(halfway);
  assert.equal(halfway.phase, "leaving");
  assert.equal(halfway.exit, 0.5);
  assert.equal(halfway.poseTime, frozen);

  assert.equal(controller.update(completeAt + LOADING_EXIT_MS, false), null);
  assert.equal(controller.update(completeAt + 1000, false), null);
});

test("cancellation and failure are never successful and use a short terminal transition", () => {
  const cancelled = new LoadController();
  cancelled.start(task("cancel"), 0);
  cancelled.update(500, false);
  const cancelling = cancelled.cancel("cancel", 600);
  assert.ok(cancelling);
  assert.equal(cancelling.phase, "cancelled");
  assert.equal(cancelling.outcome, "cancelled");
  assert.equal(cancelling.succeeded, false);
  assert.equal(cancelled.update(799, false)?.exit, 0.995);
  assert.equal(cancelled.update(800, false), null);

  const failed = new LoadController();
  failed.start(task("fail"), 0);
  failed.update(500, false);
  const error = failed.fail("fail", new Error("network down"), 700);
  assert.ok(error);
  assert.equal(error.phase, "error");
  assert.equal(error.outcome, "error");
  assert.equal(error.succeeded, false);
  assert.equal(error.error, "network down");
  assert.equal(failed.update(800, false)?.phase, "error");
  assert.equal(failed.update(900, false), null);

  failed.start(task("fail-early"), 1000);
  assert.equal(failed.fail("fail-early", "nope", 1100), null);
  assert.equal(failed.update(2000, false), null);
});

test("stale ids are ignored and a new task replaces the previous one", () => {
  const controller = new LoadController();
  controller.start(task("a"), 0);
  controller.update(200, false);
  const current = controller.readable("other", 250);
  assert.ok(current);
  assert.equal(current.id, "a");
  assert.equal(current.phase, "waiting");

  controller.start(task("b"), 300);
  assert.equal(controller.update(449, false), null);
  const b = controller.update(450, false);
  assert.ok(b);
  assert.equal(b.id, "b");
  assert.equal(b.phase, "waiting");

  controller.complete("b", 500);
  assert.deepEqual(
    controller.complete("a", 500),
    controller.readable("a", 500),
  );
  const stillB = controller.update(550, false);
  assert.ok(stillB);
  assert.equal(stillB.id, "b");
  assert.equal(stillB.phase, "leaving");
});

test("reduced motion freezes pose time and keeps completion under 200ms", () => {
  const controller = new LoadController();
  controller.start(task("reduced"), 0);
  const first = controller.update(200, true);
  assert.ok(first);
  assert.equal(first.reducedMotion, true);
  assert.equal(first.poseTime, 0);
  const later = controller.update(5000, true);
  assert.ok(later);
  assert.equal(later.poseTime, 0);
  const leaving = controller.complete("reduced", 5000);
  assert.ok(leaving);
  assert.equal(leaving.poseTime, 0);
  const end = controller.update(5000 + LOADING_EXIT_MS, true);
  assert.equal(end, null);
});

test("an empty stream can complete cleanly without a readable batch", () => {
  const controller = new LoadController();
  controller.start(task("empty"), 0);
  controller.update(200, false);
  const done = controller.complete("empty", 300);
  assert.ok(done);
  assert.equal(done.firstReadable, false);
  assert.equal(done.streaming, false);
  assert.equal(done.outcome, "complete");
  assert.equal(controller.update(500, false), null);
});

test("cancellation is safe at every phase boundary", () => {
  for (const cancelAt of [0, 149, 150, 500, 60000]) {
    const controller = new LoadController();
    controller.start(task(`cancel-${cancelAt}`), 0);
    if (cancelAt >= 150) controller.update(150, false);
    controller.update(Math.min(cancelAt, 149), false);
    const snapshot = controller.cancel(`cancel-${cancelAt}`, cancelAt);
    if (cancelAt < 150) {
      assert.equal(snapshot, null);
      assert.equal(controller.update(cancelAt + 1, false), null);
      continue;
    }
    assert.ok(snapshot);
    assert.equal(snapshot.phase, "cancelled");
    assert.equal(snapshot.succeeded, false);
    assert.ok(snapshot.exit < 1);
    assert.equal(controller.update(cancelAt + LOADING_EXIT_MS, false), null);
  }
});
