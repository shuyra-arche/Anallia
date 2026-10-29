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
  await expect(page.locator("#loadingOverlay")).toHaveCount(0);
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


test("target preparation measures the same typography without mounting target articles", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
  const result = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    const before = document.querySelectorAll("#reading article").length;
    app.scene.prepareContent("a0", "circle");
    const probe = document.querySelector(".note-measure p")!;
    const paragraph = document.querySelector("#text-a0 p")!;
    const style = (node: Element) => { const css = getComputedStyle(node); return [css.fontFamily, css.fontSize, css.lineHeight, css.letterSpacing]; };
    return { before, after: document.querySelectorAll("#reading article").length, expected: style(paragraph), prepared: style(probe) };
  });
  expect(result.after).toBe(result.before);
  expect(result.prepared).toEqual(result.expected);
});

test("source anchors survive typography and viewport changes at a nonzero reading position", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating && !(window as any).__shuyra.scene.isAnimating);
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.useContentSource({ async *open() {
      yield { type: "replace", text: Array.from({ length: 100 }, (_, i) => `源段落${i}。` + "这段文字用于检查宽度改变后的阅读源位置。".repeat(8)).join("\n\n") };
    } });
  });
  await expect(page.locator("#text-a0 p").first()).toContainText("源段落0");
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
    app.field.hub.textOffset = app.field.hub.textOffsetTarget = 900;
  });
  await page.waitForFunction(() => ((window as any).__shuyra.scene.readingPositions.get("a0", "circle")?.source ?? 0) > 0);
  const before = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    (window as any).__measureSource = (source: number) => {
      const article = document.querySelector<HTMLElement>("#text-a0")!;
      const paragraph = [...article.querySelectorAll<HTMLElement>("p[data-source-start]")].find(node => Number(node.dataset.sourceStart) <= source && source <= Number(node.dataset.sourceEnd))!;
      const text = paragraph.firstChild!;
      const start = Math.max(0, Math.min((text.textContent?.length ?? 1) - 1, source - Number(paragraph.dataset.sourceStart)));
      const range = document.createRange();
      range.setStart(text, start); range.setEnd(text, start + 1);
      const rect = range.getBoundingClientRect();
      return { offset: (rect.top - article.getBoundingClientRect().top) / app.field.state.camera.z, height: rect.height, top: rect.top };
    };
    return { ...app.scene.readingPositions.get("a0", "circle"), camera: { ...app.field.state.camera } };
  });
  await page.addStyleTag({ content: ".note p { font-family: monospace !important; font-size: 18px !important; line-height: 1.9 !important; }" });
  await page.evaluate(() => (window as any).__shuyra.scene.invalidateLayout(true));
  await page.waitForFunction(() => !(window as any).__shuyra.scene.isAnimating);
  const afterFont = await page.evaluate((before) => ({ ...(window as any).__measureSource(before.source), camera: (window as any).__shuyra.field.state.camera }), before);
  expect(afterFont.camera).toEqual(before.camera);
  expect(Math.abs(afterFont.offset - before.offset)).toBeLessThanOrEqual(2);
  const resizedAnchor = await page.evaluate(() => (window as any).__shuyra.scene.readingPositions.get("a0", "circle"));
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.waitForFunction(() => (window as any).__shuyra.field.state.viewport.width === 1000 && !(window as any).__shuyra.field.isAnimating && !(window as any).__shuyra.scene.isAnimating);
  const afterResize = await page.evaluate(anchor => (window as any).__measureSource(anchor.source), resizedAnchor);
  expect(afterResize.height).toBeGreaterThan(0);
  expect(Math.abs(afterResize.offset - resizedAnchor.offset)).toBeLessThanOrEqual(2);
  const replacementAnchor = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
    return { ...app.scene.readingPositions.get("a0", "circle"), camera: { ...app.field.state.camera } };
  });
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    const old = app.store.get("a0", "circle").text;
    const text = old.slice(0, 100) + "上游替换".repeat(20) + old.slice(200);
    app.useContentSource({ async *open() { yield { type: "replace", text }; } });
  });
  await expect(page.locator("#text-a0 .note-content")).toContainText("上游替换");
  await page.waitForFunction(() => !(window as any).__shuyra.scene.isAnimating);
  const afterReplace = await page.evaluate(anchor => ({ ...(window as any).__measureSource(anchor.source), camera: (window as any).__shuyra.field.state.camera }), replacementAnchor);
  expect(afterReplace.height).toBeGreaterThan(0);
  expect(afterReplace.camera).toEqual(replacementAnchor.camera);
  expect(Math.abs(afterReplace.offset - replacementAnchor.offset)).toBeLessThanOrEqual(2);
  await page.evaluate(() => (window as any).__shuyra.useContentSource({ async *open() {} }));
  await expect(page.locator("#text-a0 p")).toHaveCount(0);
  await page.waitForFunction(() => !(window as any).__shuyra.scene.isAnimating);
  const empty = await page.evaluate(() => ({ position: (window as any).__shuyra.scene.readingPositions.get("a0", "circle"), offset: (window as any).__shuyra.field.hub.textOffset }));
  expect(empty.position.source).toBe(0);
  expect(empty.offset).toBe(0);
});

async function prepareUncachedGrasp(page: Page) {
  await open(page, "?renderer=svg");
  await navigate(page, "a1");
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.useContentSource({ async *open(id: string, presentation: string, signal: AbortSignal) {
      if (id === "a4" && presentation === "circle") {
        await new Promise<void>(resolve => { (window as any).__releaseGrasp = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
        if (!signal.aborted) yield { type: "replace", text: "抓握目标已经可读" };
      } else yield { type: "replace", text: id === "a1" ? "抓握前正文。\n\n" + "可以继续滚动阅读这一段。\n\n".repeat(50) : app.field.catalog.get(id).expressions[presentation] };
    } });
  });
  await expect(page.locator("#text-a1 p").first()).toContainText("抓握前正文");
}

test("uncached grasp keeps the old article readable and scrollable until the target arrives", async ({ page }) => {
  await prepareUncachedGrasp(page);
  await page.evaluate(() => { const app = (window as any).__shuyra; app.reading.grasp(3); app.reading.grasp(null); });
  await expect(page.locator("#text-a1")).toBeInViewport();
  await expect(page.locator("#text-a4")).toHaveCount(0);
  await expect(page.locator("#contentStatus")).toContainText("正在准备");
  expect(await page.evaluate(() => (window as any).__shuyra.field.selected().id)).toBe("a4");
  await page.locator("#text-a1").hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => (window as any).__shuyra.scene.frame.reading.find((frame: any) => frame.chapterId === "a1")?.textOffset ?? 0)).toBeGreaterThan(10);
  await page.evaluate(() => (window as any).__releaseGrasp());
  await expect(page.locator("#text-a4 .note-content")).toContainText("抓握目标已经可读");
  await expect(page.locator("#text-a4")).toBeInViewport();
  expect(await page.evaluate(() => (window as any).__shuyra.reading.retainedChapterId)).toBeNull();
});


test("Escape cancels a pending grasp while preserving camera and the visible source text", async ({ page }) => {
  await prepareUncachedGrasp(page);
  const before = await page.evaluate(() => {
    const node = document.querySelector("#text-a1 p")!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 1);
    (window as any).__graspBookmark = range;
    return range.getBoundingClientRect().top;
  });
  await page.evaluate(() => { const app = (window as any).__shuyra; app.reading.grasp(3); app.reading.grasp(null); });
  await expect(page.locator("#contentStatus")).toContainText("正在准备");
  const camera = await page.evaluate(() => ({ ...(window as any).__shuyra.field.state.camera }));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const app = (window as any).__shuyra;
    return app.field.selected().id === "a1" && !app.reading.retainedChapterId && !app.field.isAnimating && !app.scene.isAnimating;
  });
  const after = await page.evaluate(() => ({ camera: (window as any).__shuyra.field.state.camera, top: (window as any).__graspBookmark.getBoundingClientRect().top }));
  expect(after.camera).toEqual(camera);
  expect(Math.abs(after.top - before)).toBeLessThanOrEqual(2);
  await expect(page.locator("#text-a1")).toBeInViewport();
});

test("GPU camera changes reuse numeric geometry and rebuild on shape changes", async ({ page }) => {
  await open(page, "?renderer=gpu");
  const result = await page.evaluate(() => {
    const app = (window as any).__shuyra, gpu = app.scene.gpu;
    if (!gpu) throw new Error("WebGL renderer missing");
    const viewport = app.scene.frame.viewport;
    let revision = app.scene.frame.revision + 100;
    const project = (camera: any, radius = 40) => {
      const angle = camera.rotation * Math.PI / 180;
      const x = 100 - camera.x, y = 50 - camera.y;
      return { type: "arc", startAngle: 0, endAngle: Math.PI * 2, cx: viewport.width / 2 + (x * Math.cos(angle) - y * Math.sin(angle)) * camera.z,
        cy: viewport.height / 2 + (x * Math.sin(angle) + y * Math.cos(angle)) * camera.z, radius: radius * camera.z, stroke: "#123456", strokeWidth: 1.5 * camera.z };
    };
    const render = (camera: any, radius = 40) => {
      const primitive = project(camera, radius);
      const frame = { ...app.scene.frame, revision: revision++, camera, viewport, background: null, portal: null, masks: [], labels: [], reading: [], layers: [{ id: "hubs", order: 30, primitives: [primitive] }] };
      gpu.render(frame);
      const root = gpu.layerRoots.get("hubs"), graphic = gpu.graphicsPools.get(root)[0];
      const record = gpu.primitiveRecords.get(graphic);
      const at = graphic.toGlobal({ x: record.shape.cx, y: record.shape.cy });
      return { graphic, error: Math.hypot(at.x - primitive.cx, at.y - primitive.cy) };
    };
    const initial = render({ x: 0, y: 0, z: 1, rotation: 0 });
    const builds = gpu.geometryStats.builds, reuses = gpu.geometryStats.cameraReuses;
    let maxError = 0, stable = true;
    for (let i = 1; i <= 8; i++) {
      const current = render({ x: i * 12, y: -i * 5, z: 1 + i * .04, rotation: i * 9 });
      maxError = Math.max(maxError, current.error);
      stable &&= current.graphic === initial.graphic;
    }
    const reusedBuilds = gpu.geometryStats.builds - builds;
    const reuseCount = gpu.geometryStats.cameraReuses - reuses;
    render({ x: 96, y: -40, z: 1.32, rotation: 72 }, 60);
    return { maxError, stable, reusedBuilds, reuseCount, shapeBuilds: gpu.geometryStats.builds - builds };
  });
  expect(result.stable).toBe(true);
  expect(result.maxError).toBeLessThanOrEqual(.5);
  expect(result.reusedBuilds).toBe(0);
  expect(result.reuseCount).toBe(8);
  expect(result.shapeBuilds).toBe(1);
});

test("auto avoids recognized software WebGL while explicit GPU remains available", async ({ page }) => {
  await open(page, "?renderer=gpu");
  const device = await page.evaluate(() => (window as any).__shuyra.scene.gpu.device);
  expect(device.renderer).toBeTruthy();
  await open(page, "?renderer=auto");
  const result = await page.evaluate(() => ({ kind: (window as any).__shuyra.scene.rendererKind, reason: document.querySelector<HTMLElement>("#scene")!.dataset.rendererFallback }));
  if (device.software === true) {
    expect(result.kind).toBe("svg");
    expect(result.reason).toBe("software");
  } else expect(result.kind).toBe("webgl");
  await navigate(page, "a1");
  await expect(page.locator("#text-a1")).toBeVisible();
});

test("GPU arcs and portal echoes draw numeric dashes with matching SVG widths", async ({ page }) => {
  await open(page, "?renderer=gpu");
  await page.evaluate(async () => {
    const app = (window as any).__shuyra;
    await Promise.all(["circle", "line"].map(presentation => app.store.start("d0", presentation).done));
    app.reading.flush(performance.now());
  });
  const result = await page.evaluate(() => {
    const app = (window as any).__shuyra, gpu = app.scene.gpu;
    const frame = { ...app.scene.frame, revision: app.scene.frame.revision + 100, background: null, portal: null, masks: [], labels: [], reading: [], layers: [{ id: "hubs", order: 30, primitives: [{ type: "arc", cx: 200, cy: 200, radius: 100, startAngle: 0, endAngle: Math.PI * 2, stroke: "#123456", strokeWidth: 2, dash: [4, 4] }] }] };
    gpu.render(frame);
    const root = gpu.layerRoots.get("hubs"), graphic = gpu.graphicsPools.get(root)[0];
    const arcStroke = graphic.context.instructions.find((entry: any) => entry.action === "stroke");
    const arcGaps = arcStroke.data.path.instructions.filter((entry: any) => entry.action === "moveTo").length;
    app.field.dispatch({ type: "navigate", target: "d0" });
    if (!app.field.state.passage) throw new Error("Expected color passage");
    app.field.state.passage.kind = "remote";
    app.field.state.passage.phase = .25;
    app.scene.invalidateLayout(); app.scene.render(app.field.state);
    const portal = app.scene.frame.portal;
    const echo = gpu.graphicsPools.get(gpu.containers.get("portal-strokes"))[1];
    const stroke = echo.context.instructions.find((entry: any) => entry.action === "stroke");
    const echoGaps = stroke.data.path.instructions.filter((entry: any) => entry.action === "moveTo").length;
    const echoWidth = stroke.data.style.width;
    const z = app.field.state.camera.z;
    app.scene.installSvgFallback(); app.scene.render(app.field.state);
    const svg = document.querySelector(".svg-graphics .portal-echo-stroke")!;
    return { arcGaps, echoGaps, echoWidth, expectedEchoWidth: 1.2 * z, mainWidth: portal.stroke.width, expectedMainWidth: 2.3 * z, svgWidth: Number(svg.getAttribute("stroke-width")), svgDash: svg.getAttribute("stroke-dasharray"), expectedDash: portal.echo.dash.map((n: number) => String(Math.round(n * 1000) / 1000)).join(" ") };
  });
  expect(result.arcGaps).toBeGreaterThan(20);
  expect(result.echoGaps).toBeGreaterThan(20);
  expect(result.echoWidth).toBeCloseTo(result.expectedEchoWidth, 5);
  expect(result.mainWidth).toBeCloseTo(result.expectedMainWidth, 5);
  expect(result.svgWidth).toBeCloseTo(result.expectedEchoWidth, 3);
  expect(result.svgDash).toBe(result.expectedDash);
});

test("beacon fonts and halos match SVG while GPU raster buckets retain cached text", async ({ page }) => {
  await open(page, "?renderer=gpu");
  const result = await page.evaluate(() => {
    const app = (window as any).__shuyra, gpu = app.scene.gpu;
    app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
    app.field.state.settings.background = "none";
    app.field.state.camera.z = 1;
    app.scene.invalidateLayout(); app.scene.render(app.field.state);
    const size = gpu.glyphs.size;
    for (let i = 1; i <= 5; i++) { app.field.state.camera.z = 1 + i * .001; app.scene.render(app.field.state); }
    const stable = gpu.glyphs.size === size;
    const beacon = app.scene.frame.layers.find((layer: any) => layer.id === "hubs").primitives.find((p: any) => p.type === "text");
    if (!beacon) throw new Error("Expected beacon");
    const text = [...gpu.glyphs.items()].find((value: any) => value.visible && value.text === beacon.text) as any;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-symbol").trim();
    const weight = text.style.fontWeight;
    const matchedFamily = text.style.fontFamily === family;
    const haloError = Math.abs(text.style.stroke.width * Math.hypot(text.worldTransform.a, text.worldTransform.b) - 3.5);
    app.scene.installSvgFallback(); app.scene.render(app.field.state);
    const node = [...document.querySelectorAll<SVGTextElement>('.svg-graphics [data-layer="hubs"] text')].find(value => value.textContent === beacon.text)!;
    return { stable, size, matchedFamily, weight: String(weight), haloError, svgWeight: getComputedStyle(node).fontWeight, svgStroke: node.getAttribute("stroke-width"), vector: node.getAttribute("vector-effect") };
  });
  expect(result.stable).toBe(true);
  expect(result.size).toBeGreaterThan(0);
  expect(result.matchedFamily).toBe(true);
  expect(result.weight).toBe("620");
  expect(result.svgWeight).toBe("620");
  expect(result.svgStroke).toBe("3.5");
  expect(result.vector).toBe("non-scaling-stroke");
  expect(result.haloError).toBeLessThan(.32);
});

test("hidden presentation coalesces source updates and resumes without an artificial loading flash", async ({ page }) => {
  await open(page, "?renderer=svg");
  const before = await page.locator("#text-a0").textContent();
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    app.useContentSource({ async *open(id: string, presentation: string) {
      if (id !== "a0" || presentation !== "circle") { yield { type: "replace", text: app.field.catalog.get(id).expressions[presentation] }; return; }
      yield { type: "replace", text: "第一包。" }; yield { type: "append", text: "第二包。" }; yield { type: "append", text: "第三包。" };
    } });
  });
  await page.waitForTimeout(250);
  expect(await page.locator("#text-a0").textContent()).toBe(before);
  await page.evaluate(() => { delete (document as any).hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("#text-a0")).toContainText("第一包。第二包。第三包。");
  expect(await page.evaluate(() => (window as any).__shuyra.reading.activeTask)).toBeNull();
});

test("search mirror has a native origin button that navigates to the shared source chapter", async ({ page }) => {
  await open(page, "?renderer=svg");
  await navigate(page, "q0");
  await page.locator(".hub-search-input").fill("视线");
  await page.waitForFunction(() => (window as any).__shuyra.field.state.searchResults.includes("q_hit_a0"));
  await navigate(page, "q_hit_a0");
  const button = page.locator('#text-q_hit_a0 .mirror-origin button[data-target="a0"]');
  await expect(button).toBeVisible();
  await button.click();
  await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "a0" && !(window as any).__shuyra.field.isAnimating);
  await expect(page.locator("#text-a0")).toBeVisible();
});

test("ordinary label keyboard focus reaches the numeric frame feedback", async ({ page }) => {
  await open(page, "?renderer=svg");
  const id = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    const label = app.scene.frame.labels.find((value: any) => value.attachment?.role === "ordinary" && value.interactive && !value.symbolKind);
    if (!label) throw new Error("Expected ordinary text label");
    const proxy = document.querySelector<SVGElement>(`#gLabels [data-command="${label.id}"]`)!;
    proxy.focus();
    return label.id;
  });
  await page.waitForFunction(id => (window as any).__shuyra.scene.frame.labels.find((label: any) => label.id === id)?.interaction?.focus === true, id);
  expect(await page.evaluate(id => document.activeElement?.getAttribute("data-command") === id, id)).toBe(true);
});

test("shared CPU pointer feedback can resume after keyboard focus without changing the hit", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating && !(window as any).__shuyra.scene.isAnimating);
  const point = await page.evaluate(() => {
    const app = (window as any).__shuyra;
    for (let y = 20; y < innerHeight - 20; y += 30) for (let x = 20; x < innerWidth - 20; x += 30) {
      if (document.elementFromPoint(x, y)?.closest("article,button,input")) continue;
      const hit = app.scene.hitTest({ x, y });
      if (hit?.command.type === "focus" && hit.command.hub !== app.field.state.focus && app.scene.hitTest({ x: x + 1, y })?.id === hit.id) return { x, y, target: `hub:${hit.command.hub}` };
    }
    throw new Error("Expected an exposed inactive hub hit");
  });
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(target => (window as any).__shuyra.scene.hoveredTarget === target, point.target);
  const focusTarget = await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('#text-a0 .inline-ref[data-target="a1"]')!;
    button.focus();
    return "a1";
  });
  await page.waitForFunction(target => (window as any).__shuyra.scene.hoveredTarget === target, focusTarget);
  await page.mouse.move(point.x + 1, point.y);
  await page.waitForFunction(target => (window as any).__shuyra.scene.hoveredTarget === target, point.target);
});

test("a prepared stable prefix is readable while an unfinished empty list marker waits for more text", async ({ page }) => {
  await open(page, "?renderer=svg");
  await page.evaluate(() => {
    const app = (window as any).__shuyra;
    app.useContentSource({ async *open(id: string, presentation: string) {
      if (id !== "a0" || presentation !== "circle") { yield { type: "replace", text: app.field.catalog.get(id).expressions[presentation] }; return; }
      yield { type: "replace", text: "第一段已经可以阅读。\n\n[vlist]" };
      await new Promise<void>(resolve => { (window as any).__finishMarkerStream = resolve; });
    } });
  });
  await expect(page.locator("#text-a0 p").first()).toContainText("第一段已经可以阅读");
  await page.waitForFunction(() => (window as any).__shuyra.reading.activeTask !== null);
  expect(await page.evaluate(() => (window as any).__shuyra.reading.activeTask.firstReadable)).toBe(true);
  expect(await page.evaluate(() => (window as any).__shuyra.store.get("a0", "circle").complete)).toBe(false);
  await page.evaluate(() => (window as any).__finishMarkerStream());
});
