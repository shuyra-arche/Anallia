import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?renderer=svg");
  await page.waitForFunction(() => !!(window as any).__shuyra?.handle);
  await page.evaluate(async () => {
    (window as any).__shuyra.handle.destroy();
    const { mountReader } = await import("/src/reader.ts");
    const { mountEmbeddedReader } = await import("/src/embedded-reader.ts");
    const { readerRuntime } = await import("/src/runtime/mount-reader.ts");
    const { createGeometryReader, createFieldNotebook } = await import("/src/examples/readers.ts");
    (window as any).sessionTest = { mountReader, mountEmbeddedReader, readerRuntime, createGeometryReader, createFieldNotebook,
      host: document.getElementById("scene"), events: [] };
  });
}
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const t = (window as any).sessionTest, runtime = t.readerRuntime(t.reader);
    return !runtime.field.isAnimating && !runtime.scene.isAnimating && t.reader.snapshot() !== null;
  });
}

test("subscribers can destroy document and embedded readers during notification", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const t = (window as any).sessionTest, results = [];
    for (const embedded of [false, true]) {
      const events: string[] = [], children = [...t.host.childNodes];
      const reader = embedded
        ? t.mountEmbeddedReader(t.host, t.createFieldNotebook(), { renderer: "svg", frameUrl: "/reader-frame.html" })
        : t.mountReader(t.host, t.createFieldNotebook(), { renderer: "svg" });
      await new Promise<void>(resolve => {
        reader.subscribe((state: any) => {
          events.push(state.status);
          if (state.status === "active") reader.destroy();
          if (state.status === "destroyed") resolve();
        });
      });
      results.push({ events, state: reader.getState(), preserved: children.length === t.host.childNodes.length && children.every((node, i) => node === t.host.childNodes[i]), snapshot: reader.snapshot() });
    }
    return results;
  });
  for (const item of result) expect(item).toEqual({ events: ["starting", "active", "destroyed"], state: { status: "destroyed" }, preserved: true, snapshot: null });
});

for (const [notebook, geometric, width, resumedWidth, renderer] of [[false, false, 1366, 1366, "svg"], [false, true, 1366, 1366, "svg"], [true, false, 390, 390, "svg"], [true, false, 1366, 390, "webgl"]] as const) {
  test(`snapshot survives destroy/remount with actual content (${notebook ? "notebook" : "geometry"}/${geometric ? "geometric" : "window"}/${width} to ${resumedWidth}/${renderer})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await setup(page);
    await page.evaluate(async ({ notebook, geometric }) => {
      const t = (window as any).sessionTest;
      t.definition = notebook ? t.createFieldNotebook() : t.createGeometryReader();
      t.chapter = notebook ? "log-day" : "m3";
      const chapter = t.definition.manifest.chapters.find((item: any) => item.id === t.chapter);
      t.definition.manifest.definitions.find((hub: any) => hub.id === chapter.hub).readingLayoutMode = geometric ? "geometric" : "window";
      t.reader = t.mountReader(t.host, t.definition, { renderer: "svg", chapter: t.chapter, morph: notebook ? 1 : 0, settings: { sound: false } });
      t.stop = t.reader.subscribe((state: any) => t.events.push(state));
      await t.reader.ready;
    }, { notebook, geometric });
    await settled(page);
    await page.evaluate(geometric => {
      const t = (window as any).sessionTest, app = t.readerRuntime(t.reader);
      app.field.dispatch({ type: "float-text", delta: geometric ? 270 : 900,
        maxOffset: Number(document.querySelector(`#text-${t.chapter}`)!.getAttribute("data-max-float")) });
    }, geometric);
    await settled(page);
    const before = await page.evaluate(() => {
      const t = (window as any).sessionTest;
      t.saved = JSON.parse(JSON.stringify(t.reader.snapshot()));
      const source = t.readerRuntime(t.reader).scene.readingPositions.get(t.chapter, t.saved.location.presentation)?.source;
      const state = t.reader.getState();
      const frozen = Object.isFrozen(state) && Object.isFrozen(state.location);
      t.reader.destroy();
      const terminal = t.reader.getState(), afterDestroy = t.reader.snapshot();
      t.oldCount = t.events.length;
      return { saved: t.saved, source, frozen, terminal, afterDestroy };
    });
    expect(before.saved.anchor).not.toBeNull(); expect(before.source).toBeGreaterThan(50);
    expect(before.frozen).toBe(true); expect(before.terminal).toEqual({ status: "destroyed" }); expect(before.afterDestroy).toBeNull();
    await page.setViewportSize({ width: resumedWidth, height: 844 });
    await page.evaluate(renderer => {
      const t = (window as any).sessionTest;
      t.reader = t.mountReader(t.host, t.definition, { renderer, restore: t.saved, settings: { sound: false } });
    }, renderer);
    await page.waitForFunction(() => (window as any).sessionTest.reader.getState().restoration === "matched");
    await settled(page);
    const after = await page.evaluate(() => {
      const t = (window as any).sessionTest;
      return { state: t.reader.getState(), source: t.readerRuntime(t.reader).scene.readingPositions.get(t.chapter, t.saved.location.presentation)?.source,
        noOldEvents: t.events.length === t.oldCount, history: t.readerRuntime(t.reader).field.state.history.length };
    });
    expect(after.state.location).toEqual(before.saved.location);
    expect(Math.abs(after.source - before.source)).toBeLessThan(geometric ? 100 : 40);
    expect(after.noOldEvents).toBe(true); expect(after.history).toBe(0);
    // The resumed reader still uses the existing circle/line and navigation semantics.
    expect(await page.evaluate(() => {
      const reader = (window as any).sessionTest.reader; reader.dispatch({ type: "morph" }); return reader.snapshot();
    })).toBeNull();
    await settled(page);
    expect((await page.evaluate(() => (window as any).sessionTest.reader.getState())).location.presentation)
      .not.toBe(before.saved.location.presentation);
  });
}

test("delayed restore waits for complete content and validates uniqueness once", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const t = (window as any).sessionTest;
    t.definition = t.createGeometryReader();
    t.target = "唯一的恢复目标。".repeat(20);
    t.prefix = Array.from({ length: 12 }, (_, i) => `前段${i}。` + "缓慢接收内容。".repeat(30)).join("\n\n") + "\n\n";
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); t.release = release;
    t.definition.source = { async *open() { yield { type: "replace", text: t.prefix }; await wait; yield { type: "append", text: t.target + "\n\n结束。" }; } };
    t.saved = { version: 1, location: { hub: "A", chapter: "a0", presentation: "circle" }, anchor: { kind: "paragraph", text: t.target, offset: 3 } };
    t.reader = t.mountReader(t.host, t.definition, { renderer: "svg", restore: t.saved, settings: { sound: false } });
    await t.reader.ready;
  });
  await expect.poll(() => page.evaluate(() => (window as any).sessionTest.reader.getState().content)).toBe("streaming");
  expect(await page.evaluate(() => {
    const t = (window as any).sessionTest;
    return { restoration: t.reader.getState().restoration, snapshot: t.reader.snapshot(), offset: t.readerRuntime(t.reader).field.hub.textOffset };
  })).toEqual({ restoration: "pending", snapshot: null, offset: 0 });
  await page.evaluate(() => (window as any).sessionTest.release());
  await page.waitForFunction(() => (window as any).sessionTest.reader.getState().restoration === "matched");
  await settled(page);
  expect(await page.evaluate(() => (window as any).sessionTest.readerRuntime((window as any).sessionTest.reader).field.hub.textOffset)).toBeGreaterThan(500);
});

for (const action of ["overview", "wheel", "destroy"] as const) test(`new intent wins over pending restore (${action})`, async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const t = (window as any).sessionTest, definition = t.createFieldNotebook();
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); t.release = release; t.signals = [];
    definition.source = { async *open(_id: string, _shape: string, signal: AbortSignal) { t.signals.push(signal); yield { type: "replace", text: "先读这一段。\n\n" }; await wait; yield { type: "append", text: "目标内容。" }; } };
    t.reader = t.mountReader(t.host, definition, { renderer: "svg", restore: { version: 1, location: { hub: "OBS", chapter: "obs-start", presentation: "circle" }, anchor: { kind: "paragraph", text: "目标内容。", offset: 1 } } });
    t.reader.subscribe((state: any) => t.events.push(state)); await t.reader.ready;
  });
  await page.evaluate(action => {
    const t = (window as any).sessionTest;
    if (action === "destroy") t.reader.destroy();
    else if (action === "wheel") t.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, bubbles: true }));
    else t.reader.dispatch({ type: "overview" });
    t.release();
  }, action);
  if (action === "destroy") {
    expect(await page.evaluate(() => { const t = (window as any).sessionTest; return { state: t.reader.getState(), aborted: t.signals.every((s: AbortSignal) => s.aborted) }; }))
      .toEqual({ state: { status: "destroyed" }, aborted: true });
    await expect(page.locator("#readerNavigation")).toHaveCount(0);
  } else {
    await page.waitForFunction(() => (window as any).sessionTest.reader.getState().restoration === "cancelled");
    expect(await page.evaluate(() => (window as any).sessionTest.reader.getState().restoration)).toBe("cancelled");
    if (action === "overview") await page.locator('[data-command="hud:back"]').click();
    await settled(page);
    expect(await page.evaluate(() => (window as any).sessionTest.readerRuntime((window as any).sessionTest.reader).field.hub.textOffset)).toBe(0);
  }
});

test("foreground request state distinguishes a waiting destination, failure and return from the current chapter", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const t = (window as any).sessionTest, definition = t.createFieldNotebook(), source = definition.source;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); t.release = release;
    definition.source = { async *open(id: string, presentation: any, signal: AbortSignal) {
      if (id === "log-day") { await wait; throw new Error("test failure"); }
      yield* source.open(id, presentation, signal);
    } };
    t.reader = t.mountReader(t.host, definition, { renderer: "svg", settings: { sound: false } });
    await t.reader.ready;
  });
  await settled(page);
  await page.evaluate(() => (window as any).sessionTest.reader.dispatch({ type: "navigate", target: "log-day" }));
  await page.waitForFunction(() => (window as any).sessionTest.reader.getState().request?.content === "loading");
  expect(await page.evaluate(() => {
    const reader = (window as any).sessionTest.reader, state = reader.getState();
    return { current: state.location.chapter, target: state.request.location.chapter, snapshot: reader.snapshot(), frozen: Object.isFrozen(state.request.location) };
  })).toEqual({ current: "obs-start", target: "log-day", snapshot: null, frozen: true });
  await page.evaluate(() => (window as any).sessionTest.release());
  await page.waitForFunction(() => (window as any).sessionTest.reader.getState().request?.content === "error");
  await page.evaluate(() => (window as any).sessionTest.reader.dispatch({ type: "back" }));
  await page.waitForFunction(() => (window as any).sessionTest.reader.getState().request === null);
  expect(await page.evaluate(() => (window as any).sessionTest.reader.getState().location.chapter)).toBe("obs-start");
});

test("an initial restore survives content failure and an explicit retry", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const t = (window as any).sessionTest, definition = t.createFieldNotebook();
    let attempts = 0;
    definition.source = { async *open() {
      if (++attempts === 1) throw new Error("temporarily unavailable");
      yield { type: "replace", text: "恢复目标。" };
    } };
    t.reader = t.mountReader(t.host, definition, { renderer: "svg", restore: { version: 1,
      location: { hub: "OBS", chapter: "obs-start", presentation: "circle" }, anchor: { kind: "paragraph", text: "恢复目标。", offset: 1 } } });
  });
  await page.waitForFunction(() => (window as any).sessionTest.reader.getState().request?.content === "error");
  expect(await page.evaluate(() => (window as any).sessionTest.reader.getState().restoration)).toBe("pending");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(() => (window as any).sessionTest.reader.getState().restoration === "matched");
  expect(await page.evaluate(() => (window as any).sessionTest.reader.ready)).toEqual({ status: "ready" });
});

test("invalid snapshots preserve hosts; changed content falls back to the chapter start", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const t = (window as any).sessionTest, definition = t.createFieldNotebook();
    t.host.textContent = "consumer";
    const invalid = { version: 1, location: { hub: "OBS", chapter: "a0", presentation: "circle" }, anchor: null };
    let error = ""; try { t.mountReader(t.host, definition, { restore: invalid }); } catch (e) { error = String(e); }
    const preserved = t.host.textContent === "consumer";
    t.reader = t.mountReader(t.host, definition, { renderer: "svg", restore: { ...invalid, location: { ...invalid.location, chapter: "obs-start" }, anchor: { kind: "paragraph", text: "已被作者删除的段落。", offset: 2 } } });
    await t.reader.ready;
    return { error, preserved };
  });
  expect(result.error).toContain("Invalid reader snapshot"); expect(result.preserved).toBe(true);
  await page.waitForFunction(() => (window as any).sessionTest.reader.getState().restoration === "start");
  expect(await page.evaluate(() => (window as any).sessionTest.readerRuntime((window as any).sessionTest.reader).field.hub.textOffset)).toBe(0);
});

test("embedded state and snapshots stay isolated across one-sided restore", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const t = (window as any).sessionTest;
    t.host.remove(); document.body.replaceChildren();
    t.hosts = [document.createElement("div"), document.createElement("div")];
    for (const host of t.hosts) { host.style.cssText = "display:inline-block;width:48vw;height:760px"; document.body.append(host); }
    t.options = { frameUrl: "/reader-frame.html", renderer: "svg", settings: { sound: false } };
    t.left = t.mountEmbeddedReader(t.hosts[0], t.createGeometryReader(), t.options);
    t.right = t.mountEmbeddedReader(t.hosts[1], t.createFieldNotebook(), t.options);
    t.leftEvents = []; t.rightEvents = [];
    t.left.subscribe((state: any) => t.leftEvents.push(state)); t.right.subscribe((state: any) => t.rightEvents.push(state));
    await Promise.all([t.left.ready, t.right.ready]);
    t.left.dispatch({ type: "navigate", target: "m3" }); t.right.dispatch({ type: "navigate", target: "log-day" });
  });
  await page.waitForFunction(() => {
    const t = (window as any).sessionTest;
    return t.left.snapshot()?.location.chapter === "m3" && t.right.snapshot()?.location.chapter === "log-day";
  });
  const before = await page.evaluate(() => {
    const t = (window as any).sessionTest;
    const left = t.left.snapshot(), right = t.right.snapshot();
    t.left.destroy(); t.leftCount = t.leftEvents.length; t.rightFrame = t.hosts[1].firstChild;
    t.left = t.mountEmbeddedReader(t.hosts[0], t.createGeometryReader(), { ...t.options, restore: JSON.parse(JSON.stringify(left)) });
    return { left, right };
  });
  await page.waitForFunction(() => (window as any).sessionTest.left.getState().restoration === "matched");
  expect(await page.evaluate(() => {
    const t = (window as any).sessionTest;
    return { left: t.left.getState().location, right: t.right.snapshot(), framePreserved: t.hosts[1].firstChild === t.rightFrame, noOldEvents: t.leftEvents.length === t.leftCount };
  })).toEqual({ left: before.left.location, right: before.right, framePreserved: true, noOldEvents: true });
});
