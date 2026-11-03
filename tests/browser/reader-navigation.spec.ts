import { test, expect, type Page } from "@playwright/test";

async function open(page: Page, query = "?renderer=svg") {
  await page.goto(`/dev/legacy.html${query}`);
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await expect(page.locator("#scene")).not.toHaveAttribute("data-booting", "true");
}
const control = (page: Page, name: string) => page.locator(`#readerNavigation [data-command="hud:${name}"]`);
async function settled(page: Page, chapter: string) {
  await page.waitForFunction(id => {
    const { field } = (window as any).__shuyra;
    return field.selected().id === id && !field.isAnimating;
  }, chapter);
}

test("named controls cover the reading route, queued morphs, layers and return", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await open(page);
  await expect(control(page, "back")).toBeDisabled();
  await expect(control(page, "next")).toBeDisabled();
  await expect(control(page, "next")).toBeHidden();
  await expect(control(page, "previous")).toBeHidden();
  await expect(control(page, "up")).toBeHidden();
  await expect(page.locator(".reader-count")).toHaveText("α₀ · 起点");
  await control(page, "enter").click();
  await settled(page, "a1");
  await control(page, "next").click();
  await settled(page, "a2");
  await expect(page.locator(".reader-count")).toContainText("α₂ · 同层 2 /");
  await control(page, "morph").click();
  await expect(page.locator("#readerNavigation")).toHaveAttribute("data-motion", "morph");
  await control(page, "morph").click();
  await settled(page, "a2");
  await expect(control(page, "morph")).toHaveText("展开为线");
  await control(page, "enter").click();
  await settled(page, "a21");
  await control(page, "up").click();
  await settled(page, "a2");
  await control(page, "back").click();
  await settled(page, "a21");
  await control(page, "overview").click();
  await expect(page.locator(".reader-local")).toBeHidden();
  await expect(control(page, "overview")).toBeDisabled();
  await control(page, "refocus").click();
  await settled(page, "a21");
  await control(page, "settings").click();
  await settled(page, "s0");
  await control(page, "back").click();
  await settled(page, "a21");
  expect(errors).toEqual([]);
});

test("narrow touch navigation remains inside the viewport and does not drag the camera", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await open(page);
    await settled(page, "a0");
    const before = await page.evaluate(() => ({ ...(window as any).__shuyra.field.state.camera }));
    await control(page, "sound").tap();
    const after = await page.evaluate(() => ({ ...(window as any).__shuyra.field.state.camera }));
    expect(after).toEqual(before);
    await control(page, "enter").tap();
    await settled(page, "a1");
    await control(page, "next").tap();
    await settled(page, "a2");
    await control(page, "enter").tap();
    await settled(page, "a21");
    for (const button of await page.locator("#readerNavigation button:visible").all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      expect(box!.y + box!.height).toBeLessThanOrEqual(740);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await control(page, "back").tap();
    await settled(page, "a2");
  } finally { await context.close(); }
});

test("keyboard controls, reduced motion, search and demo lifecycle share the same commands", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "?renderer=gpu");
  await control(page, "enter").focus();
  await page.keyboard.press("Enter");
  await settled(page, "a1");
  await page.keyboard.press("ArrowRight");
  await settled(page, "a2");
  await control(page, "morph").focus();
  await page.keyboard.press("Space");
  await settled(page, "a2");
  await expect(control(page, "morph")).toHaveText("收拢为圆");
  await control(page, "search").click();
  await settled(page, "q0");
  await page.locator("input.hub-search-input").fill("圆");
  await expect(page.locator("input.hub-search-input")).toHaveValue("圆");
  await control(page, "back").click();
  await settled(page, "a2");
  await page.evaluate(() => (window as any).__shuyra.switchDemoMode("leaves-ix"));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await expect(page.locator("#readerNavigation")).toBeHidden();
  await page.evaluate(() => (window as any).__shuyra.switchDemoMode(null));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await expect(page.locator("#readerNavigation")).toHaveCount(1);
  await expect(page.locator("#readerNavigation")).toBeVisible();
});

test("a failed refresh exposes a reachable retry on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    (window as any).__retryAvailable = false;
    app.useContentSource({ async *open() {
      if (!(window as any).__retryAvailable) throw new Error("test source unavailable");
      yield { type: "replace", text: "重新接续这篇阅读。" };
    } });
  });
  await expect(page.locator("#contentStatus")).toContainText("内容暂时无法打开");
  const retry = page.locator("#contentStatus").getByRole("button", { name: "重试" });
  const box = await retry.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(112);
  expect(box!.y + box!.height).toBeLessThan(300);
  await page.evaluate(() => { (window as any).__retryAvailable = true; });
  await retry.click();
  await expect(page.locator("#text-a0")).toContainText("重新接续这篇阅读");
  await expect(page.locator("#contentStatus")).toBeHidden();
});

test("overview exposes named hubs on mobile and preserves the return route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await control(page, "enter").click();
  await settled(page, "a1");
  await control(page, "overview").click();
  const index = page.getByRole("navigation", { name: "内容地图", exact: true });
  await expect(index).toBeVisible();
  await expect(index.getByRole("button")).toHaveCount(7);
  await control(page, "hub:B").click();
  await settled(page, "b0");
  await expect(index).toBeHidden();
  await control(page, "back").click();
  await expect(index).toBeVisible();
  await control(page, "refocus").click();
  await settled(page, "a1");
});

for (const renderer of ["svg", "gpu"]) {
  test(`content map points to geometry and restores pointer/focus attention (${renderer})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, `?renderer=${renderer}`);
    await control(page, "overview").click();
    await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
    const scene = page.locator("#scene");
    await control(page, "hub:B").hover();
    await expect(scene).toHaveAttribute("data-resonating-hub", "B");
    await control(page, "hub:C").focus();
    await expect(scene).toHaveAttribute("data-resonating-hub", "C");
    const box = (await control(page, "hub:B").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await expect(scene).toHaveAttribute("data-resonating-hub", "B");
    await page.mouse.move(350, 80);
    await expect(scene).toHaveAttribute("data-resonating-hub", "C");
    await page.keyboard.press("Enter");
    await settled(page, "c0");
    await control(page, "back").click();
    await expect(page.locator(".reader-index")).toBeVisible();
    await control(page, "refocus").click();
    await settled(page, "a0");
  });
}

test("anchor identity stays readable and the tablet portal does not overlap chapter controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await settled(page, "a0");
  expect((await page.locator(".reader-footer").boundingBox())!.height).toBeLessThan(110);
  await expect(page.locator(".reader-count")).toHaveText("α₀ · 起点");
  await control(page, "enter").click();
  await settled(page, "a1");
  await control(page, "next").click();
  await settled(page, "a2");
  for (const width of [701, 760, 1000, 1366]) {
    await page.setViewportSize({ width, height: 820 });
    const footer = (await page.locator(".reader-footer").boundingBox())!;
    const portal = (await page.locator(".ix-portal").boundingBox())!;
    expect(footer.x + footer.width).toBeLessThan(portal.x);
    await expect(page.locator(".reader-count")).toContainText("α₂ · 同层 2 /");
  }
});
