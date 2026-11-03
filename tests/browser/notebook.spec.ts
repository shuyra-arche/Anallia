import { test, expect, type Page } from '@playwright/test';
const control = (p: Page, key: string) => p.locator(`[data-command="hud:${key}"]`);
async function open(p: Page, chapter = 'obs-start', renderer = 'svg') {
  await p.goto(`/dev/legacy.html?example=field-notebook&chapter=${chapter}&renderer=${renderer}`);
  await p.waitForFunction(() => Boolean((window as any).__shuyra));
  await p.evaluate(() => (window as any).__shuyra.ready);
  await selected(p, chapter);
}
async function settle(p: Page) {
  await p.waitForFunction(() => {
    const app = (window as any).__shuyra;
    return !app.field.isAnimating && !app.scene.isAnimating && ['x','y','z','rotation'].every(k => app.scene.frame.camera[k] === app.field.state.camera[k]);
  });
}
async function selected(p: Page, id: string) {
  await p.waitForFunction(id => (window as any).__shuyra.field.selected().id === id, id);
  await expect(p.locator(`#text-${id}`)).toBeVisible(); await settle(p);
}
async function mapFits(p: Page) {
  await expect(p.locator('#readerNavigation')).toHaveAttribute('data-location', 'overview'); await settle(p);
  expect(await p.evaluate(() => {
    const app = (window as any).__shuyra, r = app.scene.overviewRegion;
    const inside = (x: number, y: number) => x >= r.left && x <= r.left+r.width && y >= r.top && y <= r.top+r.height;
    const primitives = app.scene.frame.layers.flatMap((l: any) => l.primitives);
    return Object.values(app.field.state.hubs).every((h: any) => {
      const shape = app.scene.frame.hitRegions.find((hit: any) => hit.id === `hub:${h.id}`).shape;
      const beacon = primitives.find((p: any) => p.type === 'text' && p.text === h.glyph);
      return beacon && inside(beacon.x,beacon.y) && (shape.type !== 'circle' || inside(shape.x-shape.radius,shape.y-shape.radius) && inside(shape.x+shape.radius,shape.y+shape.radius));
    });
  })).toBe(true);
}
for (const [width, height, renderer] of [[1366,820,'svg'],[390,844,'gpu']] as const) {
  test(`independent content navigates five levels, references and shifted space (${renderer}, ${width})`, async ({ page }) => {
    const errors: string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:'reduce'});await open(page,'obs-start',renderer);
    await expect(control(page,'settings')).toBeHidden();await expect(page.locator('#gLabels [data-command="global:settings"]')).toHaveCount(0);
    for (const id of ['obs-walk','obs-gate','obs-curb','obs-mark']) { await control(page,'enter').click(); await selected(page,id); }
    await expect(page.locator('.reader-count')).toContainText('迹₁₁₁₁');
    await expect(page.locator('.reader-location')).toContainText('石阶边缘');
    await control(page,'up').click();await selected(page,'obs-curb');
    await control(page,'back').click();await selected(page,'obs-mark');
    await page.locator('#text-obs-mark .inline-ref[data-target="log-day"]').click();await selected(page,'log-day');
    await expect(page.locator('.reader-count')).toContainText('录₁');
    await control(page,'back').click();await selected(page,'obs-mark');
    await control(page,'overview').click();await mapFits(page);
    await expect(page.locator('.reader-index button')).toHaveCount(3);
    await control(page,'hub:ATLAS').hover();await expect(page.locator('#scene')).toHaveAttribute('data-resonating-hub','ATLAS');
    await control(page,'hub:ATLAS').click();await selected(page,'atlas-start');
    await expect(page.locator('#text-atlas-start')).toHaveAttribute('data-reading-layout','geometric');
    await control(page,'enter').click();await selected(page,'atlas-scale');
    // Vertical lists intentionally fall back to the readable window renderer.
    await expect(page.locator('#text-atlas-scale')).toHaveAttribute('data-reading-layout','window');
    await expect(page.locator('#text-atlas-scale')).toContainText('近处');
    await control(page,'back').click();await selected(page,'atlas-start');
    await control(page,'back').click();await mapFits(page);
    await control(page,'refocus').click();await selected(page,'obs-mark');
    expect(errors).toEqual([]);
  });
}

test('custom search root resolves an original chapter through a keyboard search result', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);
  await control(page,'search').click();await selected(page,'find-start');
  await page.locator('.hub-search-input').fill('砖缝');
  const result=page.getByRole('button',{name:/迹₁₁₁₁.*砖缝旁的标记/});
  await expect(result).toBeAttached();await result.focus();await page.keyboard.press('Enter');await selected(page,'q_hit_obs-mark');
  await page.locator('#text-q_hit_obs-mark .mirror-origin button[data-target="obs-mark"]').click();await selected(page,'obs-mark');
  await expect(page.locator('.reader-location')).toContainText('石阶边缘');
});

for(const width of [1366,390]) {
  test(`notebook long text keeps its content anchor through morphs and map return (${width})`,async({page})=>{
    await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page,'log-day');
    await page.waitForFunction(()=> (window as any).__shuyra.field.catalog.document('log-day','line').complete);
    await expect(page.locator('#text-log-day')).toContainText('记录 36');await settle(page);
    await page.locator('#text-log-day').hover();await page.mouse.wheel(0,700);
    await expect.poll(()=>page.evaluate(()=>(window as any).__shuyra.field.hub.textOffset)).toBeGreaterThan(100);await settle(page);
    const source=(presentation:string)=>page.evaluate(p=>(window as any).__shuyra.scene.readingPositions.get('log-day',p)?.source??-1,presentation);
    const before=await source('line');expect(before).toBeGreaterThan(100);
    for(const presentation of ['circle','line']) {
      await control(page,'morph').click();await expect(page.locator('#text-log-day')).toHaveAttribute('data-presentation',presentation);await settle(page);
      expect(Math.abs(await source(presentation)-before)).toBeLessThan(32);
      await expect(page.locator('#text-log-day')).toHaveAttribute('data-reading-continuity','matched');
    }
    const restored=await source('line');await control(page,'overview').click();await mapFits(page);
    await control(page,'back').click();await selected(page,'log-day');expect(await source('line')).toBe(restored);
  });
}

test('example survives IX entry/exit and browser back without mixing catalogs',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);
  await page.locator('.ix-portal-link').click();await expect(page.locator('#leavesIx')).toBeVisible();
  await page.locator('.ix-exit').click();await selected(page,'obs-start');
  await expect(page).toHaveTitle('雨后观察手册 · Anallia');
  expect(await page.evaluate(()=>Object.keys((window as any).__shuyra.field.state.hubs))).toEqual(['OBS','LOG','ATLAS','FIND']);
  await page.goBack();await expect(page.locator('#leavesIx')).toBeVisible();
  await page.goBack();await selected(page,'obs-start');await expect(page.locator('#readerNavigation')).toHaveCount(1);
});
