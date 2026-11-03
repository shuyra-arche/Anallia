import { expect, test } from "@playwright/test";
import { settled, activate, chapter, place, morph } from "./tide-helpers.ts";
for (const renderer of ["svg", "gpu"])
  for (const width of [390, 1366])
    test(`transparent hub labels preserve color, content and circle/line meaning (${renderer}/${width})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/?renderer=${renderer}`);
      await settled(page, "shore-entry");
      await expect(
        page.locator(".label-background,.tide-index-menu,.tide-places"),
      ).toHaveCount(0);
      await expect(page.locator(".tide-series")).toContainText(
        "并置 · 同一片岸",
      );
      await chapter(page, "shore-tide", "enter");
      await chapter(page, "shell-back", "enter");
      const body = await page.locator("#text-shell-back p").allTextContents();
      await morph(page, "shell-back");
      await expect(page.locator(".tide-series")).toContainText(
        "顺读 · 一次往返",
      );
      expect(
        await page.locator("#text-shell-back p").allTextContents(),
      ).toEqual(body);
      if (width > 700) {
        const labels = await page.evaluate(() =>
          (window as any).__shuyra.scene.frame.labels
            .filter((x: any) => x.id.includes("tide:chapter:"))
            .map((x: any) => x.glyph),
        );
        expect(labels).toEqual(["1 岸", "2 潮", "3 壳", "4 拾", "5 返"]);
      }
      await place(page, "LIGHT", "light-entry");
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        "parchment",
      );
      await morph(page, "light-entry");
      await expect(page.locator(".tide-series")).toContainText(
        "并置 · 光的两面",
      );
      await place(page, "LETTER", "letter-entry");
      await morph(page, "letter-entry");
      await expect(page.locator(".tide-series")).toContainText(
        "顺读 · 信的旅程",
      );
      const colors = await page.evaluate(async () => {
        const { hubInk } = await import("/src/core/palette.ts");
        const a = (window as any).__shuyra;
        return a.scene.frame.labels.every(
          (x: any) =>
            x.color.ink ===
              hubInk(
                a.field.state.hubs[x.color.hub].theme,
                a.scene.frame.visualTheme,
              ) && !("background" in x.color),
        );
      });
      expect(colors).toBe(true);
      expect(errors).toEqual([]);
    });
for (const width of [320, 390])
  test(`short-screen projected labels stay readable, nonoverlapping and exactly hittable (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?renderer=svg");
    await settled(page, "shore-entry");
    for (const target of [
      "shore-entry",
      "shore-tide",
      "shore-found",
      "shell-back",
      "light-entry",
      "light-keeper",
      "light-window",
      "letter-entry",
      "letter-unsent",
      "letter-reply",
      "atlas-find",
    ]) {
      await page.evaluate(
        (target) =>
          (window as any).__shuyra.handle.dispatch({
            type: "navigate",
            target,
          }),
        target,
      );
      await settled(page, target);
      for (let i = 0; i < 2; i++) {
        const result = await page.evaluate(() => {
          const a = (window as any).__shuyra,
            f = a.scene.frame;
          return f.labels.map((l: any) => ({
            id: l.id,
            p: l.layout.position,
            draw: {
              x: l.layout.hinge.x + l.layout.offset.x * l.layout.scale,
              y: l.layout.hinge.y + l.layout.offset.y * l.layout.scale,
            },
            hit: a.scene.hitTest(l.layout.position)?.id,
            rect: f.hitRegions.find((h: any) => h.id === l.id).shape,
            paper: a.scene.readingBounds,
          }));
        });
        for (const label of result) {
          expect(label.p.x, label.id).toBeCloseTo(label.draw.x, 4);
          expect(label.p.y, label.id).toBeCloseTo(label.draw.y, 4);
          expect(label.hit, label.id).toBe(label.id);
          expect(label.rect.width).toBeGreaterThanOrEqual(44);
          const a = {
              left: label.p.x - label.rect.width / 2,
              right: label.p.x + label.rect.width / 2,
              top: label.p.y - label.rect.height / 2,
              bottom: label.p.y + label.rect.height / 2,
            },
            b = label.paper;
          if (b)
            expect(
              a.right <= b.left ||
                a.left >= b.left + b.width ||
                a.bottom <= b.top ||
                a.top >= b.top + b.height,
              label.id + " must not cover prose",
            ).toBe(true);
          for (const other of result)
            if (other.id !== label.id)
              expect(
                Math.abs(other.p.x - label.p.x) >=
                  (other.rect.width + label.rect.width) / 2 ||
                  Math.abs(other.p.y - label.p.y) >=
                    (other.rect.height + label.rect.height) / 2,
                label.id + " must not overlap " + other.id,
              ).toBe(true);
          expect(label.p.x - label.rect.width / 2).toBeGreaterThanOrEqual(0);
          expect(label.p.x + label.rect.width / 2).toBeLessThanOrEqual(width);
          expect(label.p.y - label.rect.height / 2).toBeGreaterThanOrEqual(115);
          expect(label.p.y + label.rect.height / 2).toBeLessThanOrEqual(568);
        }
        await morph(page, target);
      }
    }
  });
test("overview is navigated through hub labels; keyboard focus survives disappearing chapter controls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?renderer=svg");
  await settled(page, "shore-entry");
  const node = page.locator('[data-command="SHORE:tide:chapter:shore-tide"]');
  await node.focus();
  await page.keyboard.press("Enter");
  await settled(page, "shore-tide");
  await page.locator('[data-command="hud:overview"]').click();
  await expect(page.locator(".reader-map")).toBeHidden();
  const hub = page.locator('[data-command="hub:LETTER"]');
  await hub.focus();
  await page.keyboard.press("Enter");
  await settled(page, "letter-entry");
  await page.setViewportSize({ width: 320, height: 568 });
  await settled(page, "letter-entry");
  const enter = page.locator('[data-command="LETTER:tide:chapter:letter-unsent"]');
  await enter.focus();
  await page.keyboard.press("Enter");
  await settled(page, "letter-unsent");
  expect(
    await page.evaluate(() =>
      document.activeElement
        ?.closest(".tag-group")
        ?.getAttribute("data-command"),
    ),
  ).toBe("LETTER:letter-unsent");
  await page.evaluate(() => (window as any).__shuyra.handle.destroy());
  await expect(page.locator(".tide-masthead")).toHaveCount(0);
});

test("manual zoom keeps attached navigation usable without resurrecting a panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?renderer=svg");
  await settled(page, "shore-entry");
  await page.mouse.move(35, 150);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 450);
  await page.keyboard.up("Control");
  await page.waitForFunction(
    () => (window as any).__shuyra.field.state.camera.z < 0.8,
  );
  await settled(page, "shore-entry");
  const hit = await page.evaluate(() =>
    (window as any).__shuyra.scene.frame.hitRegions.find(
      (x: any) => x.id === "SHORE:shore-entry",
    ),
  );
  expect(hit.shape.width).toBeGreaterThanOrEqual(44);
  await chapter(page, "shore-tide", "enter");
  await expect(page.locator(".reader-footer")).toBeHidden();
  await expect(page.locator("details,.tide-index,.tide-places")).toHaveCount(0);
  await place(page, "LETTER", "letter-entry");
  await morph(page, "letter-entry");
});
