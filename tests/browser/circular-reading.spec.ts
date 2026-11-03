import { test, expect } from "@playwright/test";
for (const renderer of ["svg", "gpu"]) {
  test(`full-circle reading preserves hub center and gaze, independently of Alt wheel (${renderer})`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `/dev/legacy.html?demo=leaves-ix&chapter=ix-note-two&renderer=${renderer}`,
    );
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(async () => {
      const app = (window as any).__shuyra;
      await app.ready;
      await document.fonts.ready;
      app.field.setSystemReducedMotion(true);
    });
    await page.locator("[data-ix-circle-mode]").click();
    await expect(page.locator("html")).toHaveAttribute("data-circle-reading-mode", "ring");
    const article = page.locator("#text-ix-note-two"),
      root = article.locator(".geometric-content");
    await expect(root).toHaveAttribute("data-reading-slots", "77");
    await expect(root).toHaveAttribute("data-reading-progress", "0");
    const slots = Number(await root.getAttribute("data-reading-slots"));
    await expect(root.locator(".circular-row")).toHaveCount(
      Math.min(slots, Number(await root.getAttribute("data-reading-rows"))),
    );
    expect(slots).toBeGreaterThan(5);
    const snapshot = async (row: number) => {
      // Camera commands update Field before the host's next rendered frame.
      // Compare row positions only after that frame has reached the DOM.
      await page.waitForFunction(() => {
        const app = (window as any).__shuyra;
        return !app.field.isAnimating && !app.scene.isAnimating &&
          ['x', 'y', 'z', 'rotation'].every(key => app.scene.frame.camera[key] === app.field.state.camera[key]);
      });
      return {
        camera: await page.evaluate(() => ({
          ...(window as any).__shuyra.field.state.camera,
        })),
        center: await page.evaluate(async () => {
          const { worldToScreen } = await import("/src/geometry/field.ts");
          const f = (window as any).__shuyra.field;
          return worldToScreen(f.hub.center, f.state.camera, f.state.viewport);
        }),
        gaze: await root
          .locator(`[data-reading-row="${row}"]`)
          .evaluate((element) => {
            const r = element.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }),
      };
    };
    const before = await snapshot(0);
    await root.locator('[data-reading-row="0"]').hover();
    await page.mouse.wheel(0, 100);
    await expect(root).toHaveAttribute("data-reading-progress", "1");
    const after = await snapshot(1);
    expect(after.center.x).toBeCloseTo(before.center.x, 5);
    expect(after.center.y).toBeCloseTo(before.center.y, 5);
    expect(after.gaze.x).toBeCloseTo(before.gaze.x, 2);
    expect(after.gaze.y).toBeCloseTo(before.gaze.y, 2);
    await expect(root.locator('[data-reading-row="0"]')).toHaveCount(0);
    await expect(root.locator('[data-reading-row="1"]')).toHaveCSS(
      "opacity",
      "1",
    );
    await root.locator('[data-reading-row="1"]').hover();
    await page.keyboard.down("Alt");
    await page.mouse.wheel(0, 150);
    await page.keyboard.up("Alt");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__shuyra.field.state.camera.rotation,
        ),
      )
      .toBeCloseTo(after.camera.rotation + 18, 5);
    await expect(root).toHaveAttribute("data-reading-progress", "1");
    const free = await snapshot(1);
    expect(free.camera.x).toBe(after.camera.x);
    expect(free.camera.y).toBe(after.camera.y);
    await root.locator('[data-reading-row="1"]').hover();
    await page.mouse.wheel(0, 100);
    await expect(root).toHaveAttribute("data-reading-progress", "2");
    const next = await snapshot(2);
    expect(next.center.x).toBeCloseTo(free.center.x, 5);
    expect(next.center.y).toBeCloseTo(free.center.y, 5);
    expect(next.gaze.x).toBeCloseTo(free.gaze.x, 2);
    expect(next.gaze.y).toBeCloseTo(free.gaze.y, 2);
    await page.screenshot({
      path: info.outputPath(`circular-${renderer}-gaze.png`),
    });
    expect(errors).toEqual([]);
  });
}

test("short text uses compact row spacing instead of expanding across the ring", async ({
  page,
}, info) => {
  await page.goto("/dev/legacy.html?demo=leaves-ix&renderer=svg");
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(async () => {
    const app = (window as any).__shuyra;
    await app.ready;
    await document.fonts.ready;
    app.field.setSystemReducedMotion(true);
    app.useContentSource({
      async *open() {
        yield {
          type: "replace",
          text: Array.from({ length: 7 }, (_, i) => `第${i + 1}行。`).join(
            "\n\n",
          ),
        };
      },
    });
  });
  const root = page.locator("#text-ix-entry .geometric-content");
  await expect(root).toHaveAttribute("data-reading-rows", "8");
  await expect(root.locator(".circular-row")).toHaveCount(8);
  const angles = await root
    .locator(".circular-row")
    .evaluateAll((rows) =>
      rows.map((row) => Number((row as HTMLElement).dataset.baselineAngle)),
    );
  const spacing = 360 / Number(await root.getAttribute("data-reading-slots"));
  expect(spacing).toBe(5);
  for (let i = 1; i < angles.length; i++)
    expect(angles[i] - angles[i - 1]).toBeCloseTo(spacing, 5);
  await page.evaluate(async () => {
    const { worldToScreen } = await import("/src/geometry/field.ts");
    const f = (window as any).__shuyra.field,
      s = f.state;
    const center = worldToScreen(f.hub.center, s.camera, s.viewport);
    f.pan(
      {
        x: s.viewport.width * 0.45 - center.x,
        y: s.viewport.height * 0.5 - center.y,
      },
      { ...s.camera },
    );
    f.zoom(0.55, { x: s.viewport.width * 0.45, y: s.viewport.height * 0.5 });
    (window as any).__shuyra.scene.render(s);
  });
  await page.screenshot({ path: info.outputPath("circular-full-ring.png") });
});

for (const renderer of ["svg", "gpu"]) {
  test(`article wheel reads text and blank wheel still changes sibling labels (${renderer})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/dev/legacy.html?demo=leaves-ix&chapter=ix-turn&renderer=${renderer}`);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(async () => {
      const app = (window as any).__shuyra;
      await app.ready;
      await document.fonts.ready;
      app.field.setSystemReducedMotion(true);
    });
    const root = page.locator("#text-ix-turn .geometric-content");
    await expect(root).toHaveAttribute("data-reading-progress", "0");
    await root.locator('[data-reading-row="0"]').hover();
    await page.mouse.wheel(0, 100);
    await expect(root).toHaveAttribute("data-reading-progress", "1");
    expect(
      await page.evaluate(() => (window as any).__shuyra.field.selected().id),
    ).toBe("ix-turn");
    await page.mouse.move(1120, 90);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__shuyra.field.selected().id),
      )
      .toBe("ix-echo");
    await expect(page.locator("#text-ix-echo")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const renderer of ["svg", "gpu"]) {
  test(`lyric reading moves text at a fixed camera and releases ring motion on toggle (${renderer})`, async ({ page }) => {
    await page.goto(`/dev/legacy.html?demo=leaves-ix&chapter=ix-note-two&renderer=${renderer}`);
    await page.evaluate(async () => {
      const app = (window as any).__shuyra;
      await app.ready;
      await document.fonts.ready;
      app.field.setSystemReducedMotion(true);
    });
    const root = page.locator("#text-ix-note-two .geometric-content");
    await expect(root).toHaveAttribute("data-reading-slots", "72");
    const camera = () => page.evaluate(() => ({ ...(window as any).__shuyra.field.state.camera }));
    const before = await camera();
    const rowCenter = (index: number) => root.locator(`[data-reading-row="${index}"]`).evaluate(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const gaze = await rowCenter(0);
    await root.locator('[data-reading-row="0"]').hover();
    await page.mouse.wheel(0, 100);
    await expect(root).toHaveAttribute("data-reading-progress", "1");
    expect(await camera()).toEqual(before);
    const nextGaze = await rowCenter(1);
    expect(nextGaze.x).toBeCloseTo(gaze.x, 1);
    expect(nextGaze.y).toBeCloseTo(gaze.y, 1);
    await expect(root.locator('[data-reading-row="0"]')).toHaveCount(1);
    await page.locator("[data-ix-circle-mode]").click();
    await expect(root).toHaveAttribute("data-reading-slots", "77");
    await page.locator("[data-ix-circle-mode]").click();
    await expect(root).toHaveAttribute("data-reading-slots", "72");
    const afterToggle = await camera();
    await root.locator('[data-reading-row="0"]').hover();
    await page.mouse.wheel(0, 100);
    await expect(root).toHaveAttribute("data-reading-progress", "1");
    expect(await camera()).toEqual(afterToggle);
  });
}
