import { test, expect } from "@playwright/test";

for (const renderer of ["svg", "gpu"]) {
  test(`geometric DOM reading, horizontal line baselines, references and fallback (${renderer})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("shuyra.reading-layout", "geometric"),
    );
    await page.goto(`/?renderer=${renderer}`);
    await page.evaluate(async () => {
      await (window as any).__shuyra.ready;
      await document.fonts.ready;
    });
    await page.waitForFunction(
      () =>
        (window as any).__shuyra.reading.bootReady &&
        !(window as any).__shuyra.reading.activeTask,
    );
    await expect(page.locator("#readingLayoutControl")).toHaveCount(0);
    const layout = (mode: string) =>
      page.evaluate((mode) => {
        const field = (window as any).__shuyra.field;
        field.dispatch({ type: "set-reading-layout", hub: field.hub.id, mode });
      }, mode);
    await page.evaluate(() => {
      const app = (window as any).__shuyra;
      app.field.setSystemReducedMotion(true);
      app.field.state.settings.background = "none";
      app.useContentSource({
        async *open() {
          yield {
            type: "replace",
            text:
              "几何正文 {继续|a1}。\n\n" +
              "独立文字行保持来源和顺序。".repeat(25),
          };
        },
      });
    });
    await expect(page.locator("#text-a0 .note-content")).toContainText(
      "几何正文",
    );
    await layout("geometric");
    const article = page.locator("#text-a0");
    await expect(article).toHaveAttribute("data-reading-layout", "geometric", {
      timeout: 2000,
    });
    await expect
      .poll(() =>
        article
          .locator("h2.circular-row")
          .allTextContents()
          .then((parts) => parts.join("")),
      )
      .toContain("从这里开始");
    const ref = article.locator(".geometric-content button[data-target='a1']");
    await expect(ref).toBeVisible();
    await page.evaluate(() => {
      const app = (window as any).__shuyra;
      (window as any).__firstGeometricRow = document.querySelector(
        "#text-a0 .geometric-row",
      );
      app.field.pan({ x: 1, y: 0 }, app.field.state.camera);
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__firstGeometricRow ===
            document.querySelector("#text-a0 .geometric-row"),
        ),
      )
      .toBe(true);
    await page.screenshot({ path: `test-results/geometric-${renderer}.png` });
    const selection = await article
      .locator(".circular-row[data-source-start]")
      .first()
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      });
    expect(selection.length).toBeGreaterThan(0);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await ref.click();
    await expect(page.locator("#text-a1")).toBeVisible();
    await page.evaluate(() => {
      const app = (window as any).__shuyra;
      app.field.dispatch({ type: "morph" });
    });
    // The content gate may still be preparing the line expression while Field
    // is idle. Wait for the actual target presentation before placing the camera.
    await expect(page.locator("#text-a1")).toHaveAttribute("data-presentation", "line");
    await page.waitForFunction(
      () => !(window as any).__shuyra.field.isAnimating && !(window as any).__shuyra.scene.isAnimating,
    );
    await page.evaluate(() => {
      const app = (window as any).__shuyra;
      app.field.hub.angle = 25;
      app.field.state.camera = { x: 100, y: 0, z: 1, rotation: 0 };
      app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
    });
    await expect(page.locator("#text-a1")).toHaveAttribute(
      "data-reading-layout",
      "geometric",
    );
    const angles = await page
      .locator("#text-a1 .geometric-row")
      .evaluateAll((rows) =>
        rows.map((row) => Number((row as HTMLElement).dataset.baselineAngle)),
      );
    expect(angles.length).toBeGreaterThan(1);
    expect(angles.every((angle) => angle === 0)).toBe(true);
    await page.waitForFunction(() => {
      const app = (window as any).__shuyra;
      return !app.field.isAnimating && !app.scene.isAnimating &&
        app.scene.frame.camera.x === app.field.state.camera.x &&
        app.scene.frame.camera.z === app.field.state.camera.z;
    });
    await page.locator("#text-a1 .geometric-row").last().hover();
    await page.mouse.wheel(0, 800);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__shuyra.field.hub.textOffset),
      )
      .toBeGreaterThan(0);
    const sourceBefore = await page
      .locator("#text-a1 .geometric-row[data-source-start]")
      .first()
      .getAttribute("data-source-start");
    await page.addStyleTag({
      content: ".geometric-content { font-family: monospace !important; }",
    });
    await page.evaluate(() =>
      (window as any).__shuyra.scene.invalidateLayout(true),
    );
    await expect(
      page.locator("#text-a1 .geometric-row[data-source-start]").first(),
    ).toHaveAttribute("data-source-start", sourceBefore!);
    await layout("window");
    await expect(page.locator("#text-a1")).toHaveAttribute(
      "data-reading-layout",
      "window",
    );
    await expect(page.locator("#text-a1 .note-window")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (source) => {
          const { rangeAtSource, sourceRangeRect } =
            await import("/src/rendering/reading-anchor.ts");
          const article = document.querySelector<HTMLElement>("#text-a1")!;
          const located = rangeAtSource(article, source);
          if (!located) return false;
          const rect = sourceRangeRect(located.range),
            windowRect = article
              .querySelector(".note-window")!
              .getBoundingClientRect();
          return rect.bottom >= windowRect.top && rect.top <= windowRect.bottom;
        }, Number(sourceBefore)),
      )
      .toBe(true);
    await layout("geometric");
    await page.evaluate(() => {
      (window as any).__shuyra.useContentSource({
        async *open() {
          yield { type: "replace", text: "[vlist]\n设置 :: {动作|act:pulse}" };
        },
      });
    });
    await expect(page.locator("#text-a1")).toHaveAttribute(
      "data-reading-layout",
      "window",
    );
    await expect(
      page.locator("#text-a1 .note-window button[data-target='act:pulse']"),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("geometric text selection survives font layout invalidation in circle and line modes", async ({ page }) => {
  for (const morph of [0, 1]) {
    await page.goto(`/?demo=leaves-ix&renderer=svg&morph=${morph}`);
    await page.evaluate(async () => {
      await (window as any).__shuyra.ready;
      await document.fonts.ready;
    });
    const root = page.locator("#text-ix-entry .geometric-content");
    const selected = await root.locator(".geometric-row[data-source-start]").first().evaluate(el => {
      const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(5, text.textContent!.length));
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      (window as any).__selectedRow = el;
      return selection.toString();
    });
    expect(selected.length).toBeGreaterThan(0);
    await page.evaluate(() => (window as any).__shuyra.scene.invalidateLayout(true));
    await expect.poll(() => page.evaluate(() => (window as any).__selectedRow.isConnected)).toBe(false);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  }
});
