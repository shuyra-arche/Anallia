import { test, expect } from "@playwright/test";

for (const renderer of ["svg", "gpu"]) {
  test(`geometric DOM reading, horizontal line baselines, references and fallback (${renderer})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    await expect(page.locator("#readingLayout")).toHaveValue("window");
    await page.locator("#readingLayout").click();
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(() => (window as any).__shuyra.field.selected().id),
    ).toBe("a0");
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
    await page.selectOption("#readingLayout", "geometric");
    const article = page.locator("#text-a0");
    await expect(article).toHaveAttribute("data-reading-layout", "geometric", {
      timeout: 2000,
    });
    await expect(article.locator(".geometric-row").first()).toContainText(
      "从这里开始",
    );
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
      .locator(".geometric-row")
      .nth(1)
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      });
    expect(selection).toContain("几何正文");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await ref.click();
    await expect(page.locator("#text-a1")).toBeVisible();
    await page.evaluate(() => {
      const app = (window as any).__shuyra;
      app.field.dispatch({ type: "morph" });
    });
    await page.waitForFunction(
      () => !(window as any).__shuyra.field.isAnimating,
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
    await page.selectOption("#readingLayout", "window");
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
    await page.selectOption("#readingLayout", "geometric");
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
