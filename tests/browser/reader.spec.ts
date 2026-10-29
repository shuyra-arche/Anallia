import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

test("capture stable SVG and GPU reading for visual comparison", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 }, reducedMotion: "reduce" });
  try {
    for (const renderer of ["svg", "gpu"]) {
      const page = await context.newPage();
      await open(page, `?renderer=${renderer}`);
      await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
      await page.evaluate(() => {
        const app = (window as any).__shuyra;
        app.field.state.settings.background = "none";
        app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
        app.scene.invalidateLayout();
        app.scene.render(app.field.state);
      });
      await page.screenshot({ path: testInfo.outputPath(`a0-${renderer}.png`) });
      await page.close();
    }
  } finally { await context.close(); }
});


test("offline single-file export works without network access", async ({ browser }) => {
  test.skip(!existsSync(resolve("demo.html")), "Generate the single-file export first");
  const context = await browser.newContext({ offline: true, viewport: { width: 1366, height: 820 }, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    const errors: string[] = [], network: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.goto(pathToFileURL(resolve("demo.html")).href);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(() => (window as any).__shuyra.ready);
    await expect(page.locator("#text-a0")).toBeVisible();
    await navigate(page, "m3");
    await expect(page.locator("#text-m3")).toBeVisible();
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
  } finally { await context.close(); }
});

test("SVG and GPU labels activate through shared pointer hits and keyboard proxies", async ({ page }) => {
  for (const renderer of ["svg", "gpu"]) {
    await open(page, `?renderer=${renderer}`);
    await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
    const search = await page.evaluate(() => {
      const frame = (window as any).__shuyra.scene.frame;
      const label = frame.labels.find((label: any) => label.command.type === "navigate" && label.command.target === "q0");
      if (!label) throw new Error("Search label missing");
      return label.layout.position;
    });
    await page.mouse.click(search.x, search.y);
    await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "q0");
    await navigate(page, "a0");
    const settingsId = await page.evaluate(() => {
      const label = (window as any).__shuyra.scene.frame.labels.find((label: any) => label.command.type === "navigate" && label.command.target === "s0");
      if (!label) throw new Error("Settings label missing");
      return label.id;
    });
    await page.locator(`[data-command="${settingsId}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "s0");
  }
});

test("GPU label transforms match SVG proxies within half a CSS pixel across themes and geometry", async ({ page }) => {
  await open(page, "?renderer=gpu&chapter=m3");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
  const result = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
    app.field.state.settings.background = "none";
    app.field.state.settings.reducedMotion = true;
    let error = 0, compared = 0;
    for (const theme of ["light", "parchment", "celadon", "rosewood", "ivory", "dark", "obsidian", "abyss"]) {
      app.field.state.theme = theme;
      for (const morph of [0, 0.5, 0.999999, 1]) {
        app.field.hub.morph = app.field.hub.targetMorph = morph;
        for (const zoom of [0.6, 1.6]) {
          app.field.state.camera = { x: -1400, y: 450, z: zoom, rotation: zoom < 1 ? -60 : 35 };
          app.scene.invalidateLayout();
          app.scene.render(app.field.state);
          for (const label of app.scene.frame.labels) {
            if (label.opacity <= 0.001) continue;
            const gpu = app.scene.gpu.containers.get(`leaf:${label.id}`);
            const svg = document.querySelector(`[data-command="${label.id}"] .label`) as SVGGraphicsElement | null;
            if (!gpu || !svg) throw new Error(`Missing label ${label.id}`);
            const at = gpu.getGlobalPosition();
            const matrix = svg.getScreenCTM();
            if (!matrix) throw new Error(`Missing SVG transform ${label.id}`);
            const difference = Math.hypot(at.x - matrix.e, at.y - matrix.f);
            if (!Number.isFinite(difference)) throw new Error("Non-finite label transform");
            error = Math.max(error, difference);
            compared++;
          }
        }
      }
    }
    return { error, compared };
  });
  expect(result.compared).toBeGreaterThan(100);
  expect(result.error).toBeLessThanOrEqual(0.5);
});

test("GPU display order follows the scene layers with portal strokes before labels and loading last", async ({ page }) => {
  await open(page, "?renderer=gpu");
  const order = await page.evaluate(async () => {
    const app = (window as any).__shuyra;
    const { evaluateLoadingGeometry } = await import("/src/geometry/loading.ts");
    const hub = app.field.state.hubs.D;
    await app.store.start("d0", hub.targetMorph > 0.5 ? "line" : "circle").done;
    app.reading.flush(performance.now());
    app.field.dispatch({ type: "navigate", target: "d0" });
    if (!app.field.state.passage) throw new Error("Expected a portal passage");
    app.field.state.passage.phase = 0.5;
    app.scene.setLoadingGeometry(evaluateLoadingGeometry(2.4, { placement: { anchor: { x: 350, y: 350 }, scale: 0.4, angle: 0, theme: "light" } }));
    app.scene.render(app.field.state);
    return app.scene.gpu.stage.children.filter((child: any) => child.visible && child.children.length).map((child: any) => child.label);
  });
  for (const [before, after] of [["base", "portal"], ["portal", "hubs"], ["hubs", "portal-strokes"], ["portal-strokes", "labels"], ["labels", "loading"]]) {
    expect(order).toContain(before);
    expect(order).toContain(after);
    expect(order.indexOf(before), `${before} before ${after}: ${order.join(",")}`).toBeLessThan(order.indexOf(after));
  }
});

test("fast uncached content finishes loading before the normal navigation transition ends", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
  await page.evaluate(() => (window as any).__shuyra.useContentSource({ async *open() { yield { type: "replace", text: "快速正文" }; } }));
  await expect(page.locator("#text-a0 .note-content")).toContainText("快速正文");
  await page.evaluate(() => (window as any).__shuyra.field.dispatch({ type: "navigate", target: "a1" }));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__shuyra.reading.activeTask)).toBeNull();
  await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "a1");
});

test("appending below a small readable article keeps its first stable text within two pixels", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
  await page.evaluate(() => {
    let release!: () => void;
    (window as any).__appendSmall = () => release();
    (window as any).__shuyra.useContentSource({ async *open() {
      yield { type: "replace", text: "稳定的第一段。\n\n接收中" };
      await new Promise<void>(resolve => { release = resolve; });
      yield { type: "append", text: "\n\n" + "更多正文。\n\n".repeat(80) };
    } });
  });
  await expect(page.locator("#text-a0 p").first()).toHaveText("稳定的第一段。");
  const before = await page.evaluate(() => {
    const range = document.createRange();
    const node = document.querySelector("#text-a0 p")!.firstChild!;
    range.setStart(node, 0); range.setEnd(node, 1);
    (window as any).__smallRange = range;
    return range.getBoundingClientRect().top;
  });
  await page.evaluate(() => (window as any).__appendSmall());
  await expect(page.locator("#text-a0 .note-content")).toContainText("更多正文");
  const after = await page.evaluate(() => (window as any).__smallRange.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});


test("numeric SVG drawing matches frame labels and retains one keyboard proxy per label", async ({ page }) => {
  await open(page, "?renderer=svg&chapter=m3");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
  const result = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
    app.field.state.settings.background = "none";
    app.field.state.settings.reducedMotion = true;
    let error = 0, compared = 0;
    for (const morph of [0, 0.5, 0.999999, 1]) for (const zoom of [0.6, 1.6]) {
      app.field.hub.morph = app.field.hub.targetMorph = morph;
      app.field.state.camera = { x: -1400, y: 450, z: zoom, rotation: zoom < 1 ? -60 : 35 };
      app.scene.invalidateLayout();
      app.scene.render(app.field.state);
      for (const label of app.scene.frame.labels) {
        if (label.opacity <= 0.001) continue;
        const visual = document.querySelector(`.svg-graphics [data-label="${label.id}"] .label-visual`) as SVGGraphicsElement | null;
        const proxy = document.querySelector(`[data-command="${label.id}"] .label`) as SVGGraphicsElement | null;
        const actual = visual?.getScreenCTM(), expected = proxy?.getScreenCTM();
        if (!actual || !expected) throw new Error(`Missing transform ${label.id}`);
        error = Math.max(error, Math.hypot(actual.e - expected.e, actual.f - expected.f));
        compared++;
      }
    }
    return { error, compared, extraInteractions: document.querySelectorAll('.svg-graphics [role="button"], .svg-graphics [tabindex], .svg-graphics [data-command]').length };
  });
  expect(result.compared).toBeGreaterThan(20);
  expect(result.error).toBeLessThanOrEqual(0.5);
  expect(result.extraInteractions).toBe(0);
});


test("numeric SVG full-circle hubs have the expected rendered circumference", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
  const result = await page.evaluate(() => {
    const frame = (window as any).__shuyra.scene.frame;
    const primitives = frame.layers.find((layer: any) => layer.id === "hubs").primitives;
    const paths = document.querySelector('[data-layer="hubs"]')!.children;
    let compared = 0, error = 0;
    primitives.forEach((primitive: any, index: number) => {
      if (primitive.type !== "arc" || Math.abs(primitive.endAngle - primitive.startAngle) < Math.PI * 2 - 1e-8) return;
      const length = (paths[index] as SVGPathElement).getTotalLength();
      if (!(length > primitive.radius * 6)) throw new Error(`Missing circle: ${length} for radius ${primitive.radius}`);
      error = Math.max(error, Math.abs(length / (Math.PI * 2 * primitive.radius) - 1));
      compared++;
    });
    return { error, compared };
  });
  expect(result.compared).toBeGreaterThan(0);
  expect(result.error).toBeLessThan(0.002);
});
