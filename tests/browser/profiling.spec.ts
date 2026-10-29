import { expect, test } from "@playwright/test";
import type { RenderSample } from "../../src/core/render-profile.ts";

for (const renderer of ["svg", "gpu"]) {
  test(`exclusive profile stages cover full, cached and background-only frames (${renderer})`, async ({ page }) => {
    await page.goto(`/?renderer=${renderer}`);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(() => (window as any).__shuyra.ready);
    await page.evaluate(async () => {
      await document.fonts.ready;
      (window as any).__shuyra.field.state.settings.background = "flow";
    });
    await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating && !(window as any).__shuyra.scene.isAnimating);
    const samples = await page.evaluate(() => {
      const app = (window as any).__shuyra;
      const samples: RenderSample[] = [];
      app.scene.setHoveredTarget("a1");
      app.scene.setRenderProfiler((sample: RenderSample) => samples.push(sample));
      app.scene.render(app.field.state);
      app.scene.render(app.field.state);
      app.field.state.elapsed += 80;
      app.scene.render(app.field.state);
      app.scene.setHoveredTarget(null);
      app.scene.render(app.field.state);
      app.scene.setRenderProfiler(null);
      app.scene.render(app.field.state);
      return samples;
    });
    expect(samples.map(sample => sample.path)).toEqual(["full", "cached", "cached", "full"]);
    expect(samples.every(sample => sample.renderer === (renderer === "gpu" ? "webgl" : "svg"))).toBe(true);
    for (const sample of samples) {
      const durations = Object.values(sample.stages) as number[];
      expect(durations.every(ms => Number.isFinite(ms) && ms >= 0)).toBe(true);
      expect(Math.abs(durations.reduce((sum, ms) => sum + ms, 0) - sample.total)).toBeLessThan(0.001);
    }
    expect(samples[0].stages["scene.reading"]).toBeDefined();
    expect(samples[1].stages["scene.reading"]).toBeUndefined();
    if (renderer === "gpu") {
      expect(samples[0].stages["gpu.labels"]).toBeDefined();
      expect(samples[0].stages["gpu.submit"]).toBeDefined();
      expect(samples[1].stages["gpu.submit"]).toBeUndefined();
      expect(samples[2].stages["gpu.background"]).toBeDefined();
      expect(samples[2].stages["gpu.submit"]).toBeDefined();
      expect(samples[2].stages["gpu.labels"]).toBeUndefined();
    } else expect(samples[0].stages["svg.render"]).toBeDefined();
  });
}
