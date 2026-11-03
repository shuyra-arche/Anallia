import { expect, test, type Page } from "@playwright/test";

const body = Array.from({ length: 32 }, (_, i) => `第${i}段唯一标记。` + "这段文字在两种形态中表达同一内容，阅读位置应以内容而非像素为依据。".repeat(5)).join("\n\n");
async function open(page: Page, geometric = false) {
  await page.goto("/?renderer=svg");
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await page.waitForFunction(() => (window as any).__shuyra.field.catalog.document("a0", "line").complete);
  await page.evaluate(({ body, geometric }) => {
    const app = (window as any).__shuyra;
    for (const presentation of ["circle", "line"]) app.field.catalog.updateExpression("a0", presentation, body, true);
    app.field.hub.readingLayoutMode = geometric ? "geometric" : "window";
    app.field.state.settings.background = "none";
    app.scene.invalidateContent(["a0"]);
  }, { body, geometric });
  await expect(page.locator("#text-a0 .note-content")).toContainText("第31段唯一标记");
  await settle(page);
}
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const app = (window as any).__shuyra;
    return !app.field.isAnimating && !app.scene.isAnimating;
  });
}
async function scroll(page: Page, offset = 900) {
  await page.evaluate(offset => {
    const app = (window as any).__shuyra;
    app.field.dispatch({ type: "float-text", delta: offset, maxOffset: Number(document.querySelector("article.note:not([hidden])")!.getAttribute("data-max-float")) });
  }, offset);
  await settle(page);
}
async function source(page: Page, presentation: string, id = "a0") {
  return page.evaluate(({presentation, id}) => (window as any).__shuyra.scene.readingPositions.get(id, presentation)?.source ?? -1, { presentation, id });
}
async function morph(page: Page) {
  await page.locator('[data-command="hud:morph"]').click();
  await settle(page);
}
async function glyphPlacement(page: Page, source: number) {
  return page.evaluate(source => {
    const app = (window as any).__shuyra;
    const article = document.querySelector<HTMLElement>("#text-a0")!;
    const block = [...article.querySelectorAll<HTMLElement>("p[data-source-start]")].find(block => Number(block.dataset.sourceStart) <= source && source < Number(block.dataset.sourceEnd))!;
    const node = block.firstChild!;
    const start = Math.min(node.textContent!.length - 1, source - Number(block.dataset.sourceStart));
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + 1);
    return { offset: (range.getBoundingClientRect().top - article.getBoundingClientRect().top) / app.field.state.camera.z, scale: app.field.state.camera.z };
  }, source);
}

for (const geometric of [false, true]) {
  test(`long content survives both morph directions (${geometric ? "geometric" : "window"})`, async ({ page }) => {
    await open(page, geometric);
    await scroll(page, geometric ? 270 : 900);
    const before = await source(page, "circle");
    expect(before).toBeGreaterThan(100);
    const placement = geometric ? null : await glyphPlacement(page, before);
    await morph(page);
    await expect(page.locator("#text-a0")).toHaveAttribute("data-reading-continuity", "matched");
    expect(Math.abs(await source(page, "line") - before)).toBeLessThan(geometric ? 100 : 32);
    if (placement) {
      const after = await glyphPlacement(page, before);
      expect(Math.abs(after.offset - placement.offset) * after.scale).toBeLessThan(2);
    }
    await morph(page);
    expect(Math.abs(await source(page, "circle") - before)).toBeLessThan(100);
  });
}

test("distinct expressions resume their own source bookmarks instead of sharing offsets", async ({ page }) => {
  await open(page);
  await page.evaluate(body => {
    const app = (window as any).__shuyra;
    app.field.catalog.updateExpression("a0", "line", body.replaceAll("唯一标记", "另一种叙述"), true);
  }, body);
  await scroll(page);
  const circle = await source(page, "circle");
  await morph(page);
  await expect(page.locator("#text-a0")).toHaveAttribute("data-reading-continuity", "start");
  expect(await page.evaluate(() => (window as any).__shuyra.field.hub.textOffset)).toBe(0);
  await scroll(page, 450);
  const line = await source(page, "line");
  await morph(page);
  await expect(page.locator("#text-a0")).toHaveAttribute("data-reading-continuity", "bookmark");
  expect(Math.abs(await source(page, "circle") - circle)).toBeLessThan(100);
  await morph(page);
  expect(Math.abs(await source(page, "line") - line)).toBeLessThan(100);
});

test("reduced motion also maps an unchanged paragraph after new introductory sections", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const prefix = "独立引言。".repeat(100) + "\n\n";
  await page.evaluate(({ body, prefix }) => (window as any).__shuyra.field.catalog.updateExpression("a0", "line", prefix + body, true), { body, prefix });
  await scroll(page);
  const before = await source(page, "circle");
  expect(before).toBeGreaterThan(100);
  const placement = await glyphPlacement(page, before);
  await morph(page);
  expect(Math.abs(await source(page, "line") - before - prefix.length)).toBeLessThan(32);
  const after = await glyphPlacement(page, before + prefix.length);
  expect(Math.abs(after.offset - placement.offset) * after.scale).toBeLessThan(2);
  await morph(page);
  expect(Math.abs(await source(page, "circle") - before)).toBeLessThan(100);
});

async function streaming(page: Page, mode: "matched" | "missing" | "delayed") {
  await page.goto("/?renderer=svg");
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await page.evaluate(({ body, mode }) => {
    const app = (window as any).__shuyra;
    app.field.state.hubs.M.morph = app.field.state.hubs.M.targetMorph = 0;
    app.useContentSource({ async *open(id: string, presentation: string) {
      if (id !== "m3") { yield { type: "replace", text: app.field.catalog.get(id).expressions[presentation] }; return; }
      if (presentation === "circle") { yield { type: "replace", text: body }; return; }
      const prefix = mode === "matched" ? body.split("\n\n").slice(0, 12).join("\n\n") + "\n\n" : "目标段落还没有到达。\n\n";
      if (mode !== "delayed") yield { type: "replace", text: prefix };
      await new Promise<void>(resolve => { (window as any).__finishLine = resolve; });
      // Deliberately yield after cancellation too: stale generations must be ignored.
      yield { type: "append", text: mode === "matched" ? body.slice(prefix.length) : body };
    } });
    app.field.dispatch({ type: "navigate", target: "m3" });
  }, { body, mode });
  await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "m3" && typeof (window as any).__finishLine === "function");
  await settle(page);
  await scroll(page);
}

test("a stable streamed prefix transfers its anchor and later content does not move it", async ({ page }) => {
  await streaming(page, "matched");
  const before = await source(page, "circle", "m3");
  expect(before).toBeGreaterThan(100);
  await morph(page);
  await expect(page.locator("#text-m3")).toHaveAttribute("data-reading-continuity", "matched");
  expect(Math.abs(await source(page, "line", "m3") - before)).toBeLessThan(100);
  const offset = await page.evaluate(() => (window as any).__shuyra.field.hub.textOffset);
  await page.evaluate(() => (window as any).__finishLine());
  await page.waitForFunction(() => (window as any).__shuyra.field.catalog.document("m3", "line").complete);
  await settle(page);
  expect(Math.abs(await page.evaluate(() => (window as any).__shuyra.field.hub.textOffset) - offset)).toBeLessThan(2);
  await morph(page);
  expect(Math.abs(await source(page, "circle", "m3") - before)).toBeLessThan(100);
});

test("an unavailable streamed anchor starts safely and never jumps when its paragraph arrives", async ({ page }) => {
  await streaming(page, "missing");
  const before = await source(page, "circle", "m3");
  await morph(page);
  await expect(page.locator("#text-m3")).toHaveAttribute("data-reading-continuity", "start");
  expect(await page.evaluate(() => (window as any).__shuyra.field.hub.textOffset)).toBe(0);
  await page.evaluate(() => (window as any).__finishLine());
  await page.waitForFunction(() => (window as any).__shuyra.field.catalog.document("m3", "line").complete);
  await settle(page);
  expect(await page.evaluate(() => (window as any).__shuyra.field.hub.textOffset)).toBe(0);
  await morph(page);
  await expect(page.locator("#text-m3")).toHaveAttribute("data-reading-continuity", "bookmark");
  expect(Math.abs(await source(page, "circle", "m3") - before)).toBeLessThan(100);
});

test("return cancels an unready morph without consuming history or allowing late content to switch shape", async ({ page }) => {
  await streaming(page, "delayed");
  const before = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    return { offset: app.field.hub.textOffset, history: app.field.state.history.length };
  });
  await page.locator('[data-command="hud:morph"]').click();
  await expect(page.locator("#contentStatus")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__finishLine());
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => {
    const app = (window as any).__shuyra;
    return { offset: app.field.hub.textOffset, history: app.field.state.history.length,
      chapter: app.field.selected().id, morph: app.field.hub.targetMorph, transition: app.field.state.transition.kind };
  })).toEqual({ ...before, chapter: "m3", morph: 0, transition: "idle" });
});

test("history return queued during a morph finishes without leaking the old chapter anchor", async ({ page }) => {
  await open(page);
  await page.evaluate(body => {
    const app = (window as any).__shuyra;
    for (const presentation of ["circle", "line"]) app.field.catalog.updateExpression("a1", presentation, body, true);
    app.field.dispatch({ type: "navigate", target: "a1" });
  }, body);
  await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "a1");
  await settle(page);
  await scroll(page);
  await page.locator('[data-command="hud:morph"]').click();
  await page.locator('[data-command="hud:back"]').click();
  await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "a0");
  await settle(page);
  expect(await page.evaluate(() => ({ transition: (window as any).__shuyra.field.state.transition.kind, offset: (window as any).__shuyra.field.hub.textOffset }))).toEqual({ transition: "idle", offset: 0 });
});
