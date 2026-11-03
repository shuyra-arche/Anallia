import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?renderer=svg");
  await page.waitForFunction(() => !!(window as any).__shuyra?.handle);
  await page.evaluate(async () => {
    (window as any).__shuyra.handle.destroy();
    const { buildStaticReader } = await import("/src/content-builder.ts");
    const { mountReader } = await import("/src/reader.ts");
    const { readerRuntime } = await import("/src/runtime/mount-reader.ts");
    const { createStaticFieldNotebook } = await import("/src/examples/field-notebook.ts");
    (window as any).builderTest = { buildStaticReader, mountReader, readerRuntime, createStaticFieldNotebook, host: document.getElementById("scene") };
  });
}
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const t = (window as any).builderTest, runtime = t.readerRuntime(t.reader);
    return !runtime.field.isAnimating && !runtime.scene.isAnimating && t.reader.snapshot() !== null;
  });
}

for (const width of [390, 1366]) test(`minimal default geometry supports links, search, back and reordered snapshot identity (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await setup(page);
  await page.evaluate(async () => {
    const t = (window as any).builderTest;
    t.input = { entry: "start", hubs: [{ id: "NOTES" }, { id: "FIND", kind: "search" }], chapters: [
      { id: "start", hub: "NOTES", title: "开始", body: "进入{下一页|detail}。", refs: [{ label: "→", target: "detail" }] },
      { id: "detail", hub: "NOTES", parent: "start", title: "第二页", body: "这是第二页，仍然属于同一个枢。" },
      { id: "find", hub: "FIND", title: "查找", body: "查找自己的笔记。" },
    ] };
    t.reader = t.mountReader(t.host, t.buildStaticReader(t.input), { renderer: "svg", settings: { sound: false } });
    await t.reader.ready;
  });
  await page.locator('#text-start [data-target="detail"]').click();
  await expect(page.locator("#text-detail")).toBeVisible(); await settled(page);
  await page.evaluate(() => {
    const t = (window as any).builderTest; t.saved = JSON.parse(JSON.stringify(t.reader.snapshot()));
    t.reader.destroy(); t.input.hubs.reverse(); t.input.chapters.reverse();
    t.reader = t.mountReader(t.host, t.buildStaticReader(t.input), { renderer: "svg", restore: t.saved, settings: { sound: false } });
  });
  await page.waitForFunction(() => (window as any).builderTest.reader.getState().restoration === "matched");
  expect(await page.evaluate(() => (window as any).builderTest.reader.getState().location)).toEqual({ hub: "NOTES", chapter: "detail", presentation: "circle" });
  await page.locator('[data-command="hud:search"]').click();
  await page.locator(".hub-search-input").fill("第二页");
  await expect(page.locator(".reader-count")).toContainText("1 项结果");
  await page.locator('[data-command="hud:next"]').click();
  await expect(page.locator("#text-q_hit_detail")).toBeVisible();
  expect(await page.evaluate(() => (window as any).builderTest.reader.snapshot())).toBeNull();
  await page.locator('[data-command="hud:back"]').click();
  // Same-level result steps do not add history; back returns to the reading origin.
  await expect(page.locator("#text-detail")).toBeVisible();
  await page.locator('[data-command="hud:morph"]').click();
  await expect(page.locator("#text-detail")).toHaveAttribute("data-presentation", "line");
});

for (const [width, renderer] of [[390, "svg"], [1366, "webgl"]] as const) {
  test(`static notebook preserves deep navigation, authored presentations and long-reading restoration (${width}/${renderer})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await setup(page);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(async renderer => {
      const t = (window as any).builderTest;
      t.reader = t.mountReader(t.host, t.createStaticFieldNotebook(), { renderer, settings: { sound: false } });
      await t.reader.ready;
    }, renderer);
    for (const id of ["obs-walk", "obs-gate", "obs-curb", "obs-mark"]) {
      await page.locator('[data-command="hud:enter"]').click();
      await expect(page.locator(`#text-${id}`)).toBeVisible();
    }
    await page.locator('#text-obs-mark [data-target="log-day"]').click();
    await expect(page.locator("#text-log-day")).toBeVisible(); await settled(page);
    await page.evaluate(() => {
      const t = (window as any).builderTest;
      t.readerRuntime(t.reader).field.dispatch({ type: "float-text", delta: 900, maxOffset: Number(document.querySelector("#text-log-day")!.getAttribute("data-max-float")) });
    });
    await settled(page);
    const before = await page.evaluate(renderer => {
      const t = (window as any).builderTest; t.saved = JSON.parse(JSON.stringify(t.reader.snapshot()));
      const source = t.readerRuntime(t.reader).scene.readingPositions.get("log-day", "line").source;
      t.reader.destroy(); t.reader = t.mountReader(t.host, t.createStaticFieldNotebook(), { renderer, restore: t.saved, settings: { sound: false } });
      return source;
    }, renderer);
    expect(before).toBeGreaterThan(100);
    await page.waitForFunction(() => (window as any).builderTest.reader.getState().restoration === "matched"); await settled(page);
    expect(Math.abs(await page.evaluate(() => {
      const t = (window as any).builderTest; return t.readerRuntime(t.reader).scene.readingPositions.get("log-day", "line").source;
    }) - before)).toBeLessThan(40);
    await page.locator('[data-command="hud:search"]').click();
    await page.locator(".hub-search-input").fill("砖缝");
    await expect(page.locator(".reader-count")).toContainText("4 项结果");
    await page.locator('[data-command="hud:next"]').click();
    await expect(page.locator("#text-q_hit_obs-curb")).toBeVisible();
    await page.evaluate(() => (window as any).builderTest.reader.dispatch({ type: "navigate", target: "log-noon" }));
    await expect(page.locator("#text-log-noon")).toContainText("线态便签");
    await page.locator('[data-command="hud:morph"]').click();
    await expect(page.locator("#text-log-noon")).toContainText("圆态便签");
    expect(errors).toEqual([]);
  });
}
