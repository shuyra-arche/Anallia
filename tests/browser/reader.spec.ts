import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await expect(page.locator("#scene")).not.toHaveAttribute("data-booting", "true");
}

async function navigate(page: Page, target: string) {
  await page.evaluate((target) => (window as any).__shuyra.field.dispatch({ type: "navigate", target }), target);
  await page.waitForFunction((target) => {
    const app = (window as any).__shuyra;
    return app.field.selected().id === target && !app.field.isAnimating;
  }, target);
}

test("real startup, DOM reading, search and settings remain usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(page.locator("#text-a0")).toBeVisible();
  await expect(page.locator('[data-command="hud:loading"]')).toHaveCount(0);
  await expect(page.locator('[data-target="act:loading"]')).toHaveCount(0);
  await page.locator('#text-a0 [data-target="a1"]').first().click();
  await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "a1");
  await navigate(page, "q0");
  await page.locator(".hub-search-input").fill("流场");
  await expect.poll(() => page.evaluate(() => (window as any).__shuyra.field.state.searchResults.length)).toBeGreaterThan(0);
  await navigate(page, "s6");
  await page.locator('[data-target="act:theme_abyss"]').first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "abyss");
  await page.locator('[data-target="act:background_stars"]').first().click();
  await page.waitForTimeout(150);
  expect(errors).toEqual([]);
});

test("streaming displays characters, preserves stable nodes and completes a real task", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    let release: (() => void) | undefined;
    (window as any).__streamRelease = () => release?.();
    app.useContentSource({
      async *open(_id: string, _presentation: string, signal: AbortSignal) {
        yield { type: "replace", text: "稳定段落。\n\n正在到达：" };
        await new Promise<void>((resolve) => { release = resolve; });
        if (signal.aborted) return;
        yield { type: "append", text: "中" };
        await new Promise<void>((resolve) => { release = resolve; });
        if (signal.aborted) return;
        yield { type: "append", text: "文 {进入下一章|a1}" };
      },
    });
  });
  await expect(page.locator("#text-a0 .note-content")).toContainText("正在到达：");
  await page.evaluate(() => { (window as any).__stableParagraph = document.querySelector("#text-a0 p"); });
  await expect(page.locator("#contentStatus")).toContainText("继续接收");
  await page.evaluate(() => (window as any).__streamRelease());
  await expect(page.locator("#text-a0 .note-content")).toContainText("正在到达：中");
  await expect(page.locator('#text-a0 [data-target="a1"]')).toHaveCount(0);
  await page.evaluate(() => (window as any).__streamRelease());
  await expect(page.locator('#text-a0 [data-target="a1"]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__stableParagraph === document.querySelector("#text-a0 p"))).toBe(true);
  await expect(page.locator("#contentStatus")).toBeHidden();
});

test("GPU and SVG share numeric anchors and hit regions; context loss preserves reading", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const svg = await context.newPage();
  const gpu = await context.newPage();
  await open(svg, "?renderer=svg&chapter=m3");
  await open(gpu, "?renderer=gpu&chapter=m3");
  await expect(gpu.locator("#scene")).toHaveAttribute("data-renderer", "webgl");
  const frame = async (page: Page) => page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.field.state.camera = { x: -1400, y: 450, z: 1, rotation: 20 };
    app.scene.invalidateLayout();
    app.scene.render(app.field.state);
    return app.scene.frame.hitRegions;
  });
  const a = await frame(svg);
  const b = await frame(gpu);
  expect(b).toEqual(a);
  const before = await gpu.evaluate(() => {
    const app = (window as any).__shuyra;
    return { chapter: app.field.selected().id, camera: app.field.state.camera };
  });
  await gpu.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) throw new Error("GPU context was not created");
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Context-loss test extension is unavailable");
    extension.loseContext();
  });
  await expect(gpu.locator("#scene")).toHaveAttribute("data-renderer", "svg");
  expect(await gpu.evaluate(() => {
    const app = (window as any).__shuyra;
    return { chapter: app.field.selected().id, camera: app.field.state.camera };
  })).toEqual(before);
  await expect(gpu.locator("#text-m3")).toBeVisible();
  await context.close();
});
