import { expect, test, type Page } from "@playwright/test";
import { settled, activate, chapter } from "./tide-helpers.ts";
async function trace(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      a = w.__shuyra;
    w.__motionTrace = [];
    w.__tracing = true;
    const tick = () => {
      if (!w.__tracing) return;
      const s = a.field.state;
      w.__motionTrace.push({
        // Use the shared animation clock; GPU render work can compress the
        // wall-time gap between two sampling callbacks without shortening a frame.
        t: s.elapsed,
        kind: s.transition.kind,
        phase: s.transition.value?.phase,
        chapter: s.hubs[s.focus].path.at(-1),
        labels: a.scene.frame.labels.map((l: any) => ({
          id: l.id,
          p: l.layout.position,
          opacity: l.opacity,
          pageOpacity: l.page?.opacity,
          interactive: l.interactive,
          command: l.command,
          hit: l.interactive ? a.scene.hitTest(l.layout.position)?.id : null,
        })),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function take(page: Page) {
  return page.evaluate(() => {
    const w = window as any;
    w.__tracing = false;
    return w.__motionTrace as any[];
  });
}
for (const width of [390, 1366])
  for (const renderer of ["svg", "gpu"])
    test(`normal-motion labels retain identity, accept queued return and preserve touch targets (${width}/${renderer})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: width === 390,
        reducedMotion: "no-preference",
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/?renderer=${renderer}`);
      await settled(page, "shore-entry");
      await trace(page);
      // The fixed material hinge stays available while its surrounding leaves move.
      const hinge = await page.evaluate(
        () =>
          (window as any).__shuyra.scene.frame.labels.find(
            (l: any) => l.id === "SHORE:shore-entry",
          ).layout.hinge,
      );
      if (width === 390) await page.touchscreen.tap(hinge.x, hinge.y);
      else await page.mouse.click(hinge.x, hinge.y);
      await page.waitForFunction(
        () => (window as any).__shuyra.field.state.morphTurn?.phase > 0.15,
      );
      if (width === 390) await page.touchscreen.tap(hinge.x, hinge.y);
      else await page.mouse.click(hinge.x, hinge.y);
      await settled(page, "shore-entry");
      expect(
        await page
          .locator("#text-shore-entry")
          .getAttribute("data-presentation"),
      ).toBe("circle");
      const morphFrames = await take(page);
      expect(
        morphFrames.filter((f) => f.kind === "morph").length,
      ).toBeGreaterThan(10);
      if (width > 700) {
        const ids = [
          "shore-entry",
          "shore-tide",
          "shell-back",
          "shore-found",
          "shore-return",
        ];
        for (const f of morphFrames)
          for (const id of ids)
            expect(
              f.labels.some((l: any) => l.id === `SHORE:tide:chapter:${id}`),
            ).toBe(true);
        for (let i = 1; i < morphFrames.length; i++)
          for (const id of ids) {
            const a = morphFrames[i - 1],
              b = morphFrames[i];
            const p = a.labels.find((l: any) =>
              l.id.endsWith(`tide:chapter:${id}`),
            ).p;
            const q = b.labels.find((l: any) =>
              l.id.endsWith(`tide:chapter:${id}`),
            ).p;
            expect(
              Math.hypot(q.x - p.x, q.y - p.y) / Math.max(8, b.t - a.t),
            ).toBeLessThan(1.5);
          }
      }
      await chapter(page, "shore-tide", "enter", width === 390);
      await trace(page);
      await activate(page, "SHORE:tide:chapter:shell-back", width === 390);
      await page.waitForFunction(
        () => (window as any).__shuyra.field.state.contentTurn?.phase > 0.15,
      );
      await page.locator('[data-command="hud:back"]').click();
      await settled(page, "shore-tide");
      const levelFrames = await take(page);
      expect(levelFrames.some((f) => f.chapter === "shell-back")).toBe(true);
      for (const f of levelFrames)
        for (const l of f.labels)
          if (l.id.includes("tide:chapter:") && l.command.type === "navigate")
            expect(l.command.target).toBe(l.id.split("tide:chapter:")[1]);
      await trace(page);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await settled(page, "shore-return");
      const siblingFrames = await take(page);
      expect(
        siblingFrames.some((f) =>
          f.labels.some(
            (l: any) => l.id === "SHORE:shore-tide" && l.opacity > 0.01,
          ),
        ),
      ).toBe(true);
      await page.locator('[data-command="hud:back"]').click();
      await settled(page, "shore-entry");
      await trace(page);
      await page
        .locator('#text-shore-entry [data-target="light-entry"]')
        .click();
      await page.waitForFunction(
        () => !!(window as any).__shuyra.field.state.passage,
      );
      await page.locator('[data-command="hud:back"]').click();
      await settled(page, "shore-entry");
      const crossFrames = await take(page);
      if (width === 390)
        for (let i = 1; i < crossFrames.length; i++) {
          const a = crossFrames[i - 1],
            b = crossFrames[i];
          for (const leaf of b.labels) {
            const old = a.labels.find((l: any) => l.id === leaf.id);
            if (old && old.opacity > 0.2 && leaf.opacity > 0.2)
              expect(
                Math.hypot(leaf.p.x - old.p.x, leaf.p.y - old.p.y) /
                  Math.max(8, b.t - a.t),
                leaf.id + " must not jump during body reflow",
              ).toBeLessThan(5);
          }
        }
      expect(errors).toEqual([]);
      await context.close();
    });

test("normal hierarchy turns retain keyboard focus when a compact child leaf departs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?renderer=svg");
  await settled(page, "shore-entry");
  await page.locator('[data-command="SHORE:tide:chapter:shore-tide"]').focus();
  await page.keyboard.press("Enter");
  await settled(page, "shore-tide");
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-command"),
    ),
  ).toBe("SHORE:shore-tide");
});

test("pending label focus handoff respects a later explicit toolbar focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?renderer=svg");
  await settled(page, "shore-entry");
  await page.locator('[data-command="SHORE:tide:chapter:shore-tide"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => (window as any).__shuyra.field.state.contentTurn?.phase > 0.2,
  );
  await page.locator('[data-command="hud:search"]').focus();
  await settled(page, "shore-tide");
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-command"),
    ),
  ).toBe("hud:search");
});
