import { test, expect, type Page } from '@playwright/test';
const control = (page: Page, key: string) => page.locator(`[data-command="hud:${key}"]`);
async function open(page: Page, renderer = 'svg') {
  await page.goto(`/dev/legacy.html?renderer=${renderer}&chapter=a2`);
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await settle(page);
}
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const app = (window as any).__shuyra;
    return app.field.state.viewport.width === innerWidth && app.field.state.viewport.height === innerHeight &&
      app.scene.frame.viewport.width === innerWidth && app.scene.frame.viewport.height === innerHeight &&
      !app.field.isAnimating && !app.scene.isAnimating && app.scene.frame.camera.z === app.field.state.camera.z;
  });
}
async function panel(page: Page, value: string) {
  await expect(page.locator('#readerNavigation')).toHaveAttribute('data-map-panel', value);
  await settle(page);
}
async function camera(page: Page) { return page.evaluate(() => ({ ...(window as any).__shuyra.field.state.camera })); }
async function contained(page: Page) {
  const result = await page.evaluate(() => {
    const app = (window as any).__shuyra, region = app.scene.overviewRegion;
    const inside = (x: number, y: number) => x >= region.left - 0.5 && x <= region.left + region.width + 0.5 && y >= region.top - 0.5 && y <= region.top + region.height + 0.5;
    const primitives = app.scene.frame.layers.flatMap((layer: any) => layer.primitives);
    const failures: string[] = [];
    for (const hub of Object.values(app.field.state.hubs) as any[]) {
      const shape = app.scene.frame.hitRegions.find((hit: any) => hit.id === `hub:${hub.id}`).shape;
      if (shape.type === 'circle' && (!inside(shape.x - shape.radius, shape.y - shape.radius) || !inside(shape.x + shape.radius, shape.y + shape.radius))) failures.push(`${hub.id}: circle`);
      const beacon = primitives.find((item: any) => item.type === 'text' && item.text === hub.glyph);
      if (!beacon || !inside(beacon.x, beacon.y)) failures.push(`${hub.id}: beacon`);
    }
    return { failures, region };
  });
  expect(result.failures).toEqual([]);
  expect(result.region.height).toBeGreaterThan(80);
  return result.region;
}

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [568, 320]]) {
  test(`mobile map fits around its expanded and collapsed directory at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await control(page, 'overview').click();
    await panel(page, 'expanded');
    await contained(page);
    for (const item of await page.locator('.reader-map button:visible').all()) {
      const box = (await item.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await control(page, 'map-toggle').click();
    await panel(page, 'collapsed');
    await expect(page.locator('.reader-index')).toBeHidden();
    await expect(control(page, 'map-toggle')).toHaveAttribute('aria-expanded', 'false');
    await contained(page);
    await control(page, 'map-toggle').click();
    await panel(page, 'expanded');
    await contained(page);
    await control(page, 'hub:L').scrollIntoViewIfNeeded();
    await control(page, 'hub:L').click();
    await expect(page.locator('.reader-title')).toHaveText('进阶 · 十二枚标签的远行');
    await settle(page);
    expect((await camera(page)).z).toBeGreaterThan(0.18);
    await control(page, 'back').click();
    await panel(page, 'expanded');
    await contained(page);
    await control(page, 'back').click();
    await expect(page.locator('#readerNavigation')).toHaveAttribute('data-location', 'reading');
    await expect(page.locator('.reader-count')).toContainText('α₂');
  });
}

test('manual map gestures persist, return restores them, and explicit framing does not grow history', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await open(page);
    await control(page, 'overview').tap(); await panel(page, 'expanded');
    await control(page, 'map-toggle').tap(); await panel(page, 'collapsed');
    const before = await camera(page);
    const input = await context.newCDPSession(page);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 220, id: 1 }, { x: 220, y: 220, id: 2 }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 110, y: 220, id: 1 }, { x: 230, y: 220, id: 2 }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await camera(page)).z).toBeGreaterThan(before.z * 1.1);
    expect((await camera(page)).z).toBeLessThan(0.18);
    await page.mouse.move(160, 200); await page.mouse.down(); await page.mouse.move(185, 225, { steps: 5 }); await page.mouse.up();
    const manual = await camera(page);
    await page.waitForTimeout(400);
    expect(await camera(page)).toEqual(manual);
    await control(page, 'refocus').tap(); await settle(page);
    await control(page, 'back').tap(); await panel(page, 'collapsed');
    const returned = await camera(page);
    for (const key of ['x', 'y', 'z', 'rotation']) expect(returned[key]).toBeCloseTo(manual[key], 7);
    const history = await page.evaluate(() => (window as any).__shuyra.field.state.history.length);
    await control(page, 'map-fit').tap(); await settle(page); await contained(page);
    await control(page, 'map-fit').tap(); await settle(page);
    expect(await page.evaluate(() => (window as any).__shuyra.field.state.history.length)).toBe(history);
    await control(page, 'map-toggle').tap(); await panel(page, 'expanded'); await contained(page);
  } finally { await context.close(); }
});

test('normal motion, GPU, orientation changes and desktop retain usable framing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'gpu');
  await control(page, 'overview').click(); await panel(page, 'expanded'); await contained(page);
  await control(page, 'map-toggle').click(); await panel(page, 'collapsed'); await contained(page);
  await page.setViewportSize({ width: 568, height: 320 }); await settle(page); await contained(page);
  await control(page, 'map-toggle').click(); await panel(page, 'expanded'); await contained(page);
  await control(page, 'hub:B').click(); await settle(page);
  await page.setViewportSize({ width: 320, height: 568 }); await settle(page);
  await control(page, 'back').click(); await panel(page, 'expanded'); await contained(page);
  await page.setViewportSize({ width: 1366, height: 820 }); await settle(page);
  await expect(control(page, 'map-toggle')).toBeHidden();
  await expect(page.locator('.reader-index')).toBeVisible();
  await contained(page);
  await control(page, 'refocus').click(); await settle(page);
  await expect(page.locator('.reader-count')).toContainText('α₂');
});

test('return from a manually explored map keeps the real long-form reading position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/legacy.html?renderer=svg&chapter=m3');
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(() => (window as any).__shuyra.ready);
  await settle(page);
  await page.locator('#text-m3').hover(); await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => (window as any).__shuyra.field.hub.textOffset)).toBeGreaterThan(100);
  await settle(page);
  const source = await page.evaluate(() => (window as any).__shuyra.scene.readingPositions.get('m3', 'line').source);
  expect(source).toBeGreaterThan(0);
  await control(page, 'overview').click(); await panel(page, 'expanded');
  await control(page, 'map-toggle').click(); await panel(page, 'collapsed');
  await page.mouse.move(160, 200); await page.mouse.wheel(0, -150);
  await control(page, 'back').click();
  await expect(page.locator('#readerNavigation')).toHaveAttribute('data-location', 'reading');
  await settle(page);
  expect(await page.evaluate(() => (window as any).__shuyra.field.selected().id)).toBe('m3');
  expect(await page.evaluate(() => (window as any).__shuyra.scene.readingPositions.get('m3', 'line').source)).toBe(source);
  await expect(page.locator('#text-m3')).toHaveAttribute('data-presentation', 'line');
});
