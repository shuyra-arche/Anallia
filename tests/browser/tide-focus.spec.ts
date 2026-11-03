import { expect, test, type Page } from "@playwright/test";
import { settled, chapter, morph, place } from "./tide-helpers.ts";

async function audit(page: Page, trace = false) {
  return page.evaluate((trace) => {
    const w = window as any;
    const check = (f = w.__shuyra.scene.frame, s = w.__shuyra.field.state) => {
      const errors: string[] = [];
      const labels = f.labels.filter(
        (l: any) => l.opacity * (l.page?.opacity ?? 1) > 0.01,
      );
      const boxes = labels.map((l: any) => {
        const v = l.layout,
          angle = (v.degree * Math.PI) / 180;
        const axis = Math.atan2(v.offset.y, v.offset.x),
          ux = Math.cos(axis),
          uy = Math.sin(axis),
          squash = l.page?.squash ?? 1;
        const points = [-1, 1].flatMap((x) =>
          [-1, 1].map((y) => {
            const px =
              v.offset.x +
              (x * v.width * Math.cos(angle) - y * v.height * Math.sin(angle)) /
                2;
            const py =
              v.offset.y +
              (x * v.width * Math.sin(angle) + y * v.height * Math.cos(angle)) /
                2;
            const dot = px * ux + py * uy;
            return {
              x: v.hinge.x + (px + (squash - 1) * dot * ux) * v.scale,
              y: v.hinge.y + (py + (squash - 1) * dot * uy) * v.scale,
            };
          }),
        );
        return {
          id: l.id,
          left: Math.min(...points.map((p) => p.x)),
          right: Math.max(...points.map((p) => p.x)),
          top: Math.min(...points.map((p) => p.y)),
          bottom: Math.max(...points.map((p) => p.y)),
        };
      });
      const overlap = (a: any, b: any) =>
        a.left < b.right - 0.1 &&
        a.right > b.left + 0.1 &&
        a.top < b.bottom - 0.1 &&
        a.bottom > b.top + 0.1;
      for (const l of labels)
        if (l.color?.hub !== s.focus) errors.push(`foreign:${l.id}:${s.focus}`);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (
          b.left < -0.5 ||
          b.right > innerWidth + 0.5 ||
          b.top < 110 ||
          b.bottom > innerHeight + 0.5
        )
          errors.push(`edge:${b.id}`);
        for (let j = i + 1; j < boxes.length; j++)
          if (overlap(b, boxes[j]))
            errors.push(`labels:${b.id}:${boxes[j].id}`);
        for (const r of f.reading.filter(
          (r: any) => r.visible && r.opacity > 0.05,
        )) {
          const paper = document
            .getElementById(`text-${r.chapterId}`)
            ?.getBoundingClientRect();
          if (
            overlap(b, {
              left: r.left,
              right: r.left + r.width,
              top: r.top,
              bottom: r.top + r.height,
            })
          )
            errors.push(`paper:${b.id}`);
          if (paper && overlap(b, paper))
            errors.push(`projected-paper:${b.id}`);
        }
      }
      return errors;
    };
    if (!trace) return check();
    w.__focusErrors = [];
    const scene = w.__shuyra.scene,
      project = scene.frameProjection;
    w.__stopFocusTrace = () => {
      scene.frameProjection = project;
    };
    // Inspect the frame with the state that produced it, not a new command
    // dispatched between that rendered frame and the next animation callback.
    scene.frameProjection = (base: any, state: any, feedback: any) => {
      const frame = project(base, state, feedback);
      w.__focusErrors.push(...check(frame, state));
      return frame;
    };
    return [];
  }, trace);
}

for (const width of [320, 1366])
  test(`focused labels remain exclusive and collision-free through normal transitions (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto("/?renderer=svg");
    await settled(page, "shore-entry");
    await audit(page, true);
    await morph(page, "shore-entry");
    await morph(page, "shore-entry");
    await chapter(page, "shore-tide", "enter");
    await chapter(page, "shell-back", "enter");
    await page.locator('[data-command="hud:back"]').click();
    await settled(page, "shore-tide");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await settled(page, "shore-return");
    await place(page, "LETTER", "letter-entry");
    await page.locator('[data-command="hud:back"]').click();
    await page.waitForFunction(
      () =>
        (window as any).__shuyra.field.state.overview &&
        !(window as any).__shuyra.field.isAnimating,
    );
    expect(
      await page
        .locator("#readerNavigation .hud-controls")
        .evaluate((el) =>
          [...el.querySelectorAll<HTMLButtonElement>("button")]
            .filter((b) => b.getBoundingClientRect().width > 0)
            .every(
              (b) =>
                b.scrollWidth <= b.clientWidth &&
                b.getBoundingClientRect().left >= 0 &&
                b.getBoundingClientRect().right <= innerWidth,
            ),
        ),
    ).toBe(true);
    await page.getByRole("button", { name: "继续阅读", exact: true }).click();
    await settled(page, "shore-return");
    const errors = await page.evaluate(() => {
      const w = window as any;
      w.__stopFocusTrace();
      return [...new Set(w.__focusErrors)];
    });
    expect(errors).toEqual([]);
  });

async function dense(page: Page) {
  await page.goto("/?renderer=svg");
  await settled(page, "shore-entry");
  await page.evaluate(async () => {
    const a = (window as any).__shuyra;
    a.handle.destroy();
    const { buildStaticReader } = await import("/src/content-builder.ts");
    const { mountReader } = await import("/src/reader.ts");
    const { readerRuntime } = await import("/src/runtime/mount-reader.ts");
    const { mountTideEdition } = await import("/src/demos/tide-edition.ts");
    const { installTideHubControls } =
      await import("/src/demos/tide-hub-controls.ts");
    const definition = buildStaticReader({
      title: "密集长标题验证",
      entry: "root",
      hubs: [
        { id: "SHORE", glyph: "岸" },
        { id: "LIGHT", glyph: "塔", theme: "parchment" },
      ],
      chapters: [
        {
          id: "root",
          hub: "SHORE",
          name: "索引",
          title: "长标题与二十个子章节",
          body: "从这里选择章节。\n\n正文保持自己的阅读区域。",
        },
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `child-${i}`,
          hub: "SHORE",
          parent: "root",
          name: `第${i + 1}节非常长的章节标签名称`,
          title: `第 ${i + 1} 节的完整标题`,
          body: "每个子章节都有稳定身份。\n\n通过父标签返回索引。",
        })),
        {
          id: "deep",
          hub: "SHORE",
          parent: "child-19",
          name: "细节",
          title: "第三层细节",
          body: "仍在同一枢内。",
        },
        {
          id: "other",
          hub: "LIGHT",
          name: "另一枢",
          title: "独立的第二枢",
          body: "这里只显示本枢标签。",
        },
      ],
    });
    const host = document.getElementById("scene")!;
    a.handle = mountReader(host, definition, {
      renderer: "svg",
      settings: { sound: false, reducedMotion: true, background: "none" },
    });
    mountTideEdition(host, a.handle, definition);
    const r = readerRuntime(a.handle);
    const stop = installTideHubControls(host, r);
    const unsub = a.handle.subscribe((s: any) => {
      if (s.status === "destroyed") {
        stop();
        unsub();
      }
    });
    Object.assign(a, { field: r.field, scene: r.scene, reading: r.reading });
  });
  await settled(page, "root");
}
for (const size of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 1366, height: 844 },
])
  test(`dense long-title content uses bounded local windows (${size.width}x${size.height})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: size,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await dense(page);
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      expect(await audit(page)).toEqual([]);
      const visible = await page.evaluate(() =>
        (window as any).__shuyra.scene.frame.labels
          .filter((l: any) => l.interactive && l.command.type === "navigate")
          .map((l: any) => ({
            target: l.command.target,
            glyph: l.glyph,
            aria: l.aria,
          })),
      );
      for (const l of visible) {
        seen.add(l.target);
        expect(l.aria).toContain("完整标题");
        expect(l.glyph.length).toBeLessThan(l.aria.length);
      }
      const more = page.locator(
        '[data-command="SHORE:tide:window:after"][tabindex="0"]',
      );
      if (!(await more.count())) break;
      await more.focus();
      await page.keyboard.press("Enter");
      await settled(page, "root");
    }
    expect([...seen].sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `child-${i}`).sort(),
    );
    await chapter(page, "child-19", "enter");
    await chapter(page, "deep", "enter");
    await chapter(page, "child-19", "up");
    await chapter(page, "root", "up");
    expect(await audit(page)).toEqual([]);
    const leaf = await page.evaluate(
      () =>
        (window as any).__shuyra.scene.frame.labels.find(
          (l: any) => l.interactive && l.localScrollHub,
        )?.layout.position,
    );
    expect(leaf).toBeTruthy();
    await page.mouse.move(leaf.x, leaf.y);
    await page.mouse.wheel(0, 400);
    await page.waitForFunction(
      () => (window as any).__shuyra.field.hub.localScroll > 0,
    );
    await settled(page, "root");
    expect(await audit(page)).toEqual([]);
    // A real touch drag over a local leaf moves only its existing scroll owner.
    const before = await page.evaluate(() => {
      const a = (window as any).__shuyra;
      return {
        scroll: a.field.hub.localScroll,
        chapter: a.handle.getState().location.chapter,
        p: a.scene.frame.labels.find(
          (l: any) => l.interactive && l.localScrollHub,
        ).layout.position,
      };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: before.p.x, y: before.p.y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: before.p.x, y: Math.min(size.height - 10, before.p.y + 70) },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForFunction(
      (before) => (window as any).__shuyra.field.hub.localScroll < before,
      before.scroll,
    );
    await settled(page, "root");
    expect(await audit(page)).toEqual([]);
    await page.evaluate(() => (window as any).__shuyra.handle.destroy());
    await expect(page.locator(".tide-hub-targets")).toHaveCount(0);
    await context.close();
  });
