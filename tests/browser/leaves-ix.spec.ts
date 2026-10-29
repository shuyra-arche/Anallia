import { test, expect } from "@playwright/test";

for (const renderer of ["svg", "gpu"]) {
  test(`IX labyrinth has geometric prose, branching notes and a horizontal line room (${renderer})`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("shuyra.reading-layout", "window");
      localStorage.setItem("shuyra.background", "flow");
      localStorage.setItem("shuyra.sound", "true");
    });
    await page.goto(`/?demo=leaves-ix&renderer=${renderer}`);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(async () => {
      await (window as any).__shuyra.ready;
      await document.fonts.ready;
      (window as any).__shuyra.field.setSystemReducedMotion(true);
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-demo",
      "leaves-ix",
    );
    await expect(page.locator("#text-ix-entry")).toHaveAttribute(
      "data-reading-layout",
      "geometric",
    );
    await expect(page.locator(".ix-empty-room")).toBeVisible();
    await expect(page.locator(".ix-heading")).toContainText("原创示例文字");
    await page.screenshot({
      path: info.outputPath(`ix-${renderer}-entry.png`),
    });
    await page.evaluate(() => {
      const field = (window as any).__shuyra.field;
      field.dispatch({
        type: "set-reading-layout",
        hub: field.hub.id,
        mode: "window",
      });
    });
    await expect(page.locator("#text-ix-entry")).toHaveAttribute(
      "data-reading-layout",
      "window",
    );
    await page.locator(".ix-route [data-ix-target='ix-note']").click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__shuyra.field.hub.readingLayoutMode,
        ),
      )
      .toBe("geometric");
    await expect(page.locator(".ix-location")).toContainText("注释 01");
    await expect(page.locator("#text-ix-note")).toHaveAttribute(
      "data-reading-layout",
      "geometric",
    );
    await page.locator("[data-ix-back]").click();
    await expect(page.locator(".ix-location")).toContainText("门槛");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__shuyra.field.hub.readingLayoutMode,
        ),
      )
      .toBe("window");
    await expect(page.locator("#text-ix-entry")).toHaveAttribute(
      "data-reading-layout",
      "window",
    );
    await page.locator(".ix-route [data-ix-target='ix-note']").click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__shuyra.field.hub.readingLayoutMode,
        ),
      )
      .toBe("geometric");
    await page.locator("[data-ix-next]").click();
    await expect(page.locator(".ix-location")).toContainText("注释 02");
    await page.locator("[data-ix-back]").click();
    await expect(page.locator(".ix-location")).toContainText("注释 01");
    await page.locator(".ix-route [data-ix-target='ix-void']").click();
    await expect(page.locator(".ix-location")).toContainText("空室");
    await expect(page.locator("#text-ix-void")).toHaveAttribute(
      "data-presentation",
      "line",
    );
    await expect(page.locator("#text-ix-void")).toHaveAttribute(
      "data-reading-layout",
      "geometric",
    );
    const beforeRotation = await page.evaluate(
      () => (window as any).__shuyra.field.state.camera.rotation,
    );
    await page.locator("[data-ix-rotate]").click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__shuyra.field.state.camera.rotation,
        ),
      )
      .toBeCloseTo(beforeRotation + 18, 5);
    const angles = await page
      .locator("#text-ix-void .geometric-row")
      .evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.baselineAngle),
      );
    expect(angles.length).toBeGreaterThan(1);
    expect(angles.every((angle) => angle === "0")).toBe(true);
    await page.screenshot({ path: info.outputPath(`ix-${renderer}-line.png`) });
    await page.evaluate(() => {
      const field = (window as any).__shuyra.field;
      field.dispatch({
        type: "set-reading-layout",
        hub: field.hub.id,
        mode: "window",
      });
    });
    await expect(page.locator("#text-ix-void .note-window")).toBeVisible();
    expect(
      await page.evaluate(() => ({
        layout: localStorage.getItem("shuyra.reading-layout"),
        background: localStorage.getItem("shuyra.background"),
        sound: localStorage.getItem("shuyra.sound"),
      })),
    ).toEqual({ layout: "window", background: "flow", sound: "true" });
    expect(errors).toEqual([]);
  });
}

test("IX mobile route stays navigable and exit restores the ordinary entry", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?demo=leaves-ix&renderer=svg");
  await expect(page.locator(".ix-heading h1")).toBeVisible();
  await expect(page.locator("#text-ix-entry")).toBeVisible();
  await page.screenshot({ path: info.outputPath("ix-mobile.png") });
  await page.locator(".ix-route [data-ix-target='ix-note']").click();
  await expect(page.locator(".ix-location")).toContainText("注释 01");
  await expect(page.locator(".ix-exit")).toHaveAttribute("href", "/");
  await page.locator(".ix-exit").click();
  await expect(page.locator("#text-a0")).toBeVisible();
  await expect(page.locator("#leavesIx")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-demo",
    "leaves-ix",
  );
});
