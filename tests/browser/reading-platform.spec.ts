import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const device of [
  { name: "large desktop", width: 1920, height: 1080, dpr: 2, mobile: false, resized: { width: 1600, height: 900 } },
  { name: "mobile emulation", width: 390, height: 844, dpr: 3, mobile: true, resized: { width: 375, height: 812 } },
]) {
  test(`reading source remains stable across append, font and viewport changes (${device.name}, DPR ${device.dpr})`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.dpr,
      isMobile: device.mobile, hasTouch: device.mobile, reducedMotion: "reduce" });
    try {
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/?renderer=auto");
      await page.waitForFunction(() => Boolean((window as any).__shuyra));
      await page.evaluate(() => (window as any).__shuyra.ready);
      await page.evaluate(async () => {
        await document.fonts.ready;
        const app = (window as any).__shuyra;
        app.field.state.settings.background = "none";
        app.useContentSource({ async *open(_id: string, _presentation: string, signal: AbortSignal) {
          yield { type: "replace", text: Array.from({ length: 80 }, (_, i) => `平台段落${i}。` + "固定源位置用于检查不同像素密度下的排版缓存。".repeat(8)).join("\n\n") };
          await new Promise<void>(resolve => { (window as any).__appendPlatform = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
          if (!signal.aborted) yield { type: "append", text: "\n\n平台追加完成。" + "继续到达的正文不会推动当前阅读位置。".repeat(100) };
        } });
      });
      await expect(page.locator("#text-a0 p").first()).toContainText("平台段落0");
      await page.evaluate(() => { const app = (window as any).__shuyra; app.field.pan({ x: 0, y: 0 }, app.field.state.camera); app.field.hub.textOffset = app.field.hub.textOffsetTarget = 900; });
      await page.waitForFunction(() => ((window as any).__shuyra.scene.readingPositions.get("a0", "circle")?.source ?? 0) > 0);
      const before = await page.evaluate(() => {
        const app = (window as any).__shuyra;
        (window as any).__platformSource = (source: number) => {
          const article = document.querySelector<HTMLElement>("#text-a0")!;
          const p = [...article.querySelectorAll<HTMLElement>("p[data-source-start]")].find(p => Number(p.dataset.sourceStart) <= source && source <= Number(p.dataset.sourceEnd))!;
          const text = p.firstChild!, start = Math.max(0, Math.min((text.textContent?.length ?? 1) - 1, source - Number(p.dataset.sourceStart)));
          const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 1);
          const rect = range.getBoundingClientRect();
          return { offset: (rect.top - article.getBoundingClientRect().top) / app.field.state.camera.z, height: rect.height, scale: app.field.state.camera.z };
        };
        return { ...app.scene.readingPositions.get("a0", "circle"), camera: { ...app.field.state.camera } };
      });
      await page.evaluate(() => (window as any).__appendPlatform());
      await expect(page.locator("#text-a0 .note-content")).toContainText("平台追加完成");
      await page.waitForFunction(() => !(window as any).__shuyra.scene.isAnimating);
      const afterAppend = await page.evaluate(source => (window as any).__platformSource(source), before.source);
      expect(Math.abs(afterAppend.offset - before.offset) * afterAppend.scale).toBeLessThanOrEqual(2);
      const fontAnchor = await page.evaluate(() => (window as any).__shuyra.scene.readingPositions.get("a0", "circle"));
      await page.addStyleTag({ content: ".note p { font-family: monospace !important; font-size: 17px !important; line-height: 1.9 !important; }" });
      await page.evaluate(() => (window as any).__shuyra.scene.invalidateLayout(true));
      await page.waitForFunction(() => !(window as any).__shuyra.scene.isAnimating);
      const afterFont = await page.evaluate(source => (window as any).__platformSource(source), fontAnchor.source);
      expect(Math.abs(afterFont.offset - fontAnchor.offset) * afterFont.scale).toBeLessThanOrEqual(2);
      const resizedAnchor = await page.evaluate(() => (window as any).__shuyra.scene.readingPositions.get("a0", "circle"));
      await page.setViewportSize(device.resized);
      await page.waitForFunction(width => (window as any).__shuyra.field.state.viewport.width === width && !(window as any).__shuyra.scene.isAnimating && !(window as any).__shuyra.field.isAnimating, device.resized.width);
      const afterResize = await page.evaluate(source => (window as any).__platformSource(source), resizedAnchor.source);
      expect(afterResize.height).toBeGreaterThan(0);
      expect(Math.abs(afterResize.offset - resizedAnchor.offset) * afterResize.scale).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => devicePixelRatio)).toBe(device.dpr);
      expect(errors).toEqual([]);
      const report = info.outputPath("reading-platform.json");
      await writeFile(report, JSON.stringify({ device, before, fontAnchor, resizedAnchor, afterAppend, afterFont, afterResize,
        renderer: await page.evaluate(() => (window as any).__shuyra.scene.rendererKind), emulated: true }, null, 2));
      await info.attach("reading-platform.json", { path: report, contentType: "application/json" });
    } finally { await context.close(); }
  });
}
