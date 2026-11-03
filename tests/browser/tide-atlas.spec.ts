import { expect, test, type Page } from "@playwright/test";
import { settled, activate, chapter, place, morph } from "./tide-helpers.ts";
async function open(
  page: Page,
  width: number,
  renderer = "svg",
  reduced = true,
) {
  await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
  await page.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await page.goto(`/?renderer=${renderer}`);
  await settled(page, "shore-entry");
}
for (const width of [320, 390, 1366])
  test(`the hub carries hierarchy, neighbouring chapters and spatial destinations (${width})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, width);
    await expect(page.locator(".reader-footer")).toBeHidden();
    await expect(
      page.locator(".tide-places,.tide-index,.tide-index-menu"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: "潮汐之间", exact: true }),
    ).toHaveCount(1);
    await chapter(page, "shore-tide", "enter");
    await chapter(page, "shore-found", "next");
    await chapter(page, "shore-tide", "previous");
    await chapter(page, "shell-back", "enter");
    if (width === 320) {
      await page.locator("#text-shell-back p").first().hover();
      await page.mouse.wheel(0, 650);
      await settled(page, "shell-back");
    }
    await page.locator('#text-shell-back [data-target="letter-entry"]').click();
    await settled(page, "letter-entry");
    await page.locator('[data-command="hud:back"]').click();
    await settled(page, "shell-back");
    await chapter(page, "shore-tide", "up");
    await place(page, "LIGHT", "light-entry");
    await chapter(page, "light-keeper", "enter");
    await place(page, "SHORE", "shore-tide");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
test("keyboard chapter labels, search and return use the same command port", async ({
  page,
}) => {
  await open(page, 1366, "gpu");
  await place(page, "LETTER", "letter-entry");
  const id = await page.evaluate(
    () =>
      (window as any).__shuyra.scene.frame.labels.find(
        (x: any) =>
          x.command.type === "navigate" && x.command.target === "letter-unsent",
      ).id,
  );
  const label = page.locator(`[data-command="${id}"]`);
  await label.focus();
  await page.keyboard.press("Enter");
  await settled(page, "letter-unsent");
  await page.keyboard.press("ArrowRight");
  await settled(page, "letter-reply");
  await page.locator('[data-command="hud:search"]').click();
  await settled(page, "atlas-find");
  await page.getByRole("searchbox").fill("蓝纸");
  await chapter(page, "q_hit_shore-found", "next");
  await settled(page, "q_hit_shore-found");
  await page.locator('[data-command="hud:back"]').click();
  await settled(page, "letter-reply");
});
test("long prose preserves its semantic anchor through hub morph and destroy/recreate", async ({
  page,
}) => {
  await open(page, 390);
  await place(page, "LIGHT", "light-entry");
  await chapter(page, "light-keeper", "enter");
  await page.locator("#text-light-keeper p").first().hover();
  await page.mouse.wheel(0, 700);
  await settled(page, "light-keeper");
  await page.waitForFunction(
    () => (window as any).__shuyra.handle.snapshot() !== null,
  );
  const saved = await page.evaluate(() =>
    (window as any).__shuyra.handle.snapshot(),
  );
  expect(saved.anchor).not.toBeNull();
  expect(saved.anchor.text).not.toContain("十七点四十");
  await morph(page, "light-keeper");
  await morph(page, "light-keeper");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__shuyra.handle.snapshot()?.anchor?.text,
      ),
    )
    .toBe(saved.anchor.text);
  await page.evaluate(async (saved) => {
    const a = (window as any).__shuyra;
    a.handle.destroy();
    const { mountReader } = await import("/src/reader.ts");
    const { readerRuntime } = await import("/src/runtime/mount-reader.ts");
    const { createTideAtlas } = await import("/src/examples/tide-atlas.ts");
    const { mountTideEdition } = await import("/src/demos/tide-edition.ts");
    const { installTideHubControls } = await import("/src/demos/tide-hub-controls.ts");
    const d = createTideAtlas(),
      host = document.getElementById("scene")!;
    a.handle = mountReader(host, d, {
      renderer: "svg",
      restore: saved as any,
      settings: { sound: false, background: "none" },
    });
    mountTideEdition(host, a.handle, d);
    const r = readerRuntime(a.handle);
    installTideHubControls(host, r);
    a.scene = r.scene;
    a.field = r.field;
    a.reading = r.reading;
  }, saved);
  await page.waitForFunction(
    () => (window as any).__shuyra.handle.getState().restoration === "matched",
  );
  expect(
    await page.evaluate(
      () => (window as any).__shuyra.handle.snapshot()?.anchor?.text,
    ),
  ).toBe(saved.anchor.text);
  await expect(page.locator(".tide-masthead")).toHaveCount(1);
});
test("ordinary motion permits repeated curve gestures and a return during travel", async ({
  page,
}) => {
  await open(page, 1366, "svg", false);
  for (let i = 0; i < 2; i++) {
    const p = await page.evaluate(
      () =>
        (window as any).__shuyra.scene.frame.labels.find(
          (x: any) => x.id === "SHORE:shore-entry",
        ).layout.hinge,
    );
    await page.mouse.click(p.x, p.y);
  }
  await settled(page, "shore-entry");
  await expect(page.locator("#text-shore-entry")).toHaveAttribute(
    "data-presentation",
    "circle",
  );
  await page.locator('#text-shore-entry [data-target="light-entry"]').click();
  await page.locator('[data-command="hud:back"]').click();
  await settled(page, "shore-entry");
});
test("phone touch uses the actual hub hit regions and remembers each hub chapter", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.goto("/?renderer=gpu");
    await settled(page, "shore-entry");
    await chapter(page, "shore-tide", "enter", true);
    await chapter(page, "shell-back", "enter", true);
    await chapter(page, "shore-tide", "up", true);
    await place(page, "LIGHT", "light-entry", true);
    await chapter(page, "light-keeper", "enter", true);
    await place(page, "SHORE", "shore-tide", true);
    await place(page, "LIGHT", "light-keeper", true);
  } finally {
    await context.close();
  }
});
