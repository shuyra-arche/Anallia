import { expect, test, type Page } from "@playwright/test";
import { settled, chapter, activate, morph } from "./tide-helpers.ts";
async function trace(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      a = w.__shuyra,
      scene = a.scene,
      project = scene.frameProjection;
    w.__turnFrames = [];
    w.__stopTurnTrace = () => {
      scene.frameProjection = project;
      return w.__turnFrames;
    };
    scene.frameProjection = (base: any, state: any, feedback: any) => {
      const frame = project(base, state, feedback),
        turn = state.contentTurn;
      if (turn) {
        const current = frame.labels.find(
          (l: any) =>
            l.attachment?.role === "ordinary" && l.visual === "current",
        );
        w.__turnFrames.push({
          phase: turn.phase,
          from: turn.from,
          to: turn.to,
          direction: turn.direction,
          started: turn.started,
          camera: { ...state.camera },
          perspective: document
            .getElementById("reading")!
            .style.perspectiveOrigin.split(" ")
            .map(parseFloat),
          hinge: current?.layout.hinge,
          reading: frame.reading.map((r: any) => ({
            id: r.chapterId,
            opacity: r.opacity,
            blur: r.blur,
            inert: r.inert,
            rotation: r.rotationY,
            offset: r.textOffset,
            pivot: {
              x: r.left + r.transformOrigin.x * r.scale,
              y: r.top + r.transformOrigin.y * r.scale,
            },
          })),
        });
      }
      return frame;
    };
  });
}
async function take(page: Page) {
  return page.evaluate(() => (window as any).__stopTurnTrace()) as Promise<
    any[]
  >;
}
function verify(frames: any[]) {
  expect(frames.length).toBeGreaterThan(12);
  expect(
    frames.filter((f) => !f.reading.length).length / frames.length,
  ).toBeLessThan(0.08);
  const starts = new Map<number, any>();
  for (const f of frames) {
    if (!starts.has(f.started)) starts.set(f.started, f);
    const start = starts.get(f.started);
    expect(f.camera).toEqual(start.camera);
    if (
      (f.phase > 0.03 && f.phase < 0.47) ||
      (f.phase > 0.53 && f.phase < 0.97)
    )
      expect(f.reading.length).toBeGreaterThan(0);
    for (const r of f.reading) {
      expect(r.id).toBe(f.phase < 0.5 ? f.from : f.to);
      expect(r.inert).toBe(true);
      expect(r.blur).toBe(0);
      expect(Math.abs(r.rotation)).toBeLessThanOrEqual(90);
      expect(f.hinge).toBeTruthy();
      expect(
        Math.hypot(f.perspective[0] - f.hinge.x, f.perspective[1] - f.hinge.y),
      ).toBeLessThan(0.02);
      expect(
        Math.hypot(r.pivot.x - f.hinge.x, r.pivot.y - f.hinge.y),
      ).toBeLessThan(0.02);
    }
  }
}
for (const width of [390, 1366])
  for (const renderer of ["svg", "gpu"])
    test(`paired leaves share a stable hinge, including queued return (${width}/${renderer})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/?renderer=${renderer}`);
      await settled(page, "shore-entry");
      await trace(page);
      await chapter(page, "shore-tide", "enter");
      await chapter(page, "shore-entry", "up");
      await page.locator('[data-command="hud:back"]').click();
      await settled(page, "shore-tide");
      await page.locator('[data-command="hud:back"]').click();
      await settled(page, "shore-entry");
      let frames = await take(page);
      expect([
        ...new Map(frames.map((f) => [f.started, f.direction])).values(),
      ]).toEqual([1, -1, 1, -1]);
      verify(frames);
      expect(frames.some((f) => f.direction === -1)).toBe(true);
      await morph(page, "shore-entry");
      await trace(page);
      await chapter(page, "shore-tide", "enter");
      await activate(page, "SHORE:tide:chapter:shell-back");
      await page.waitForFunction(
        () => (window as any).__shuyra.field.state.contentTurn?.phase > 0.16,
      );
      await page.locator('[data-command="hud:back"]').click();
      await settled(page, "shore-tide");
      verify(await take(page));
    });

for (const resized of [false, true])
  test(`history restores the long parent before opening (resized=${resized})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 568 });
    await page.goto("/?renderer=svg");
    await settled(page, "shore-entry");
    await page.evaluate(() => {
      const a = (window as any).__shuyra,
        body = Array.from(
          { length: 22 },
          (_, i) => `第${i + 1}段独立标记。潮水走过海岸，留下可以辨认的痕迹。`,
        ).join("\n\n");
      for (const p of ["circle", "line"])
        a.field.catalog.updateExpression("shore-entry", p, body, true);
      a.scene.invalidateContent(["shore-entry"]);
    });
    await settled(page, "shore-entry");
    await expect(page.locator("#text-shore-entry p")).toHaveCount(22);
    await page.locator("#text-shore-entry p").first().hover();
    await page.mouse.wheel(0, 550);
    await settled(page, "shore-entry");
    const before = await page.evaluate(() => {
      const a = (window as any).__shuyra;
      return {
        offset: a.field.hub.textOffset,
        anchor: a.handle.snapshot()?.anchor?.text,
      };
    });
    expect(before.offset).toBeGreaterThan(200);
    await chapter(page, "shore-tide", "enter");
    if (resized) {
      await page.setViewportSize({ width: 320, height: 568 });
      await settled(page, "shore-tide");
    }
    await trace(page);
    await page.locator('[data-command="hud:back"]').click();
    await settled(page, "shore-entry");
    const frames = await take(page),
      incoming = frames
        .flatMap((f) => (f.phase > 0.53 ? f.reading : []))
        .filter((r) => r.id === "shore-entry");
    expect(incoming.length).toBeGreaterThan(5);
    const finalOffset = await page.evaluate(
      () => (window as any).__shuyra.field.hub.textOffset,
    );
    for (const r of incoming)
      expect(Math.abs(r.offset - finalOffset)).toBeLessThan(1);
    if (!resized) expect(finalOffset).toBeCloseTo(before.offset, 1);
    expect(
      await page.evaluate(
        () => (window as any).__shuyra.handle.snapshot()?.anchor?.text,
      ),
    ).toBe(before.anchor);
  });

test("async content keeps the old page until ready; cancellation and reduced motion remain explicit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?renderer=svg");
  await settled(page, "shore-entry");
  await page.evaluate(() => {
    const w = window as any,
      a = w.__shuyra;
    a.useContentSource({
      async *open(id: string, p: string, signal: AbortSignal) {
        if (id === "shore-tide")
          await new Promise<void>((resolve) => {
            w.__releaseTurn = resolve;
          });
        if (signal.aborted) return;
        yield { type: "replace", text: a.field.catalog.get(id).expressions[p] };
      },
    });
  });
  await settled(page, "shore-entry");
  await activate(page, "SHORE:tide:chapter:shore-tide");
  await page.waitForFunction(
    () => typeof (window as any).__releaseTurn === "function",
  );
  expect(
    await page.evaluate(() => (window as any).__shuyra.field.state.contentTurn),
  ).toBeNull();
  await expect(page.locator("#text-shore-entry")).toBeVisible();
  await page.keyboard.press("Escape");
  await settled(page, "shore-entry");
  await page.evaluate(() => (window as any).__releaseTurn());
  await activate(page, "SHORE:tide:chapter:shore-tide");
  await page.waitForFunction(
    () => (window as any).__shuyra.handle.getState().request !== null,
  );
  await trace(page);
  await page.evaluate(() => (window as any).__releaseTurn());
  await settled(page, "shore-tide");
  verify(await take(page));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await chapter(page, "shore-entry", "up");
  expect(
    await page.evaluate(() =>
      (window as any).__shuyra.scene.frame.reading.every(
        (r: any) => r.rotationY === 0 && r.blur === 0,
      ),
    ),
  ).toBe(true);
});

for (const renderer of ["svg", "gpu"])
  test(`geometric reading rotates around its material anchor (${renderer})`, async ({
    page,
  }) => {
    await page.goto(`/dev/legacy.html?renderer=${renderer}&chapter=d0`);
    await page.evaluate(() => (window as any).__shuyra.ready);
    await page.evaluate(() => {
      const a = (window as any).__shuyra;
      for (const id of ["d0", "d1"])
        a.field.catalog.updateExpression(
          id,
          "circle",
          "沿圆周阅读的正文。\n\n在同一锚点翻到下一层。",
          true,
        );
      a.field.dispatch({
        type: "set-reading-layout",
        hub: "D",
        mode: "geometric",
      });
      a.scene.invalidateContent(["d0", "d1"]);
    });
    await expect(page.locator("#text-d0")).toHaveAttribute(
      "data-reading-layout",
      "geometric",
    );
    await page.waitForFunction(() => {
      const a = (window as any).__shuyra;
      return !a.field.isAnimating && !a.scene.isAnimating;
    });
    await page.evaluate(async () => {
      const w = window as any,
        a = w.__shuyra,
        { nodeS, material, hubToScreen } =
          await import("/src/geometry/field.ts");
      w.__geometricTurn = [];
      const render = a.scene.render.bind(a.scene);
      a.scene.render = (...args: any[]) => {
        const value = render(...args),
          s = a.field.state;
        if (s.contentTurn) {
          const h = a.field.hub,
            rows = a.field.siblings(),
            i = rows.findIndex((x: any) => x.id === a.field.selected().id),
            hinge = hubToScreen(
              h,
              material(h, nodeS(h, i, rows.length, s.camera, s.viewport)),
              s.camera,
              s.viewport,
            );
          for (const r of a.scene.frame.reading) {
            const el = document.getElementById(`text-${r.chapterId}`)!;
            w.__geometricTurn.push({
              hinge,
              phase: s.contentTurn.phase,
              origin: el.style.transformOrigin.split(" ").map(parseFloat),
              scale: r.scale,
              frameOrigin: r.transformOrigin,
            });
          }
        }
        return value;
      };
      a.field.dispatch({ type: "navigate", target: "d1" });
    });
    await page.waitForFunction(() => {
      const a = (window as any).__shuyra;
      return (
        a.field.selected().id === "d1" &&
        !a.field.isAnimating &&
        !a.scene.isAnimating
      );
    });
    const frames = await page.evaluate(() => (window as any).__geometricTurn);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.some((f: any) => f.phase < 0.5)).toBe(true);
    expect(frames.some((f: any) => f.phase > 0.5)).toBe(true);
    for (const f of frames) {
      expect(f.scale).toBe(1);
      expect(
        Math.hypot(f.origin[0] - f.hinge.x, f.origin[1] - f.hinge.y),
      ).toBeLessThan(0.05);
      expect(f.frameOrigin).toEqual(f.hinge);
    }
  });
