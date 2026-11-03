import { test, expect } from '@playwright/test';

async function setup(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const records: {target: EventTarget; type: string; listener: unknown; capture: boolean; active: boolean}[] = [];
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      if ((this === window || this === document) && ['keydown','resize','visibilitychange','pointermove','pointerup','pointercancel'].includes(type)) {
        if (!records.some(r => r.active && r.target === this && r.type === type && r.listener === listener && r.capture === capture)) {
          const record = {target:this,type,listener,capture,active:true}; records.push(record);
          if (typeof options === 'object' && options?.signal) {
            record.active = !options.signal.aborted;
            add.call(options.signal,'abort',()=>{record.active=false},{once:true});
          }
        }
      }
      return add.call(this,type,listener,options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      for (const r of records) if(r.target===this && r.type===type && r.listener===listener && r.capture===capture) r.active=false;
      return remove.call(this,type,listener,options);
    };
    (window as any).ownedListenerCount = () => records.filter(r => r.active).length;
  });
  await page.goto('/?renderer=svg');
  await page.waitForFunction(() => !!(window as any).__shuyra?.handle);
  await page.evaluate(async () => {
    (window as any).__shuyra.handle.destroy();
    const { mountReader } = await import('/src/reader.ts');
    const { createFieldNotebook } = await import('/src/examples/field-notebook.ts');
    const { contentManifest } = await import('/src/content/generated/manifest.ts');
    const { createLocalContentSource } = await import('/src/content/local.ts');
    (window as any).mountTest = { mountReader, createFieldNotebook,
      baseline: () => ({ manifest: contentManifest, source: createLocalContentSource(), entry: 'a0' }),
      host: document.getElementById('scene') };
  });
}

for (const [width, height, renderer] of [[1366,820,'svg'],[390,844,'webgl']] as const) {
  test(`document lifecycle alternates both consumers without stale keyboard or DOM (${renderer})`, async ({ page }) => {
    await page.setViewportSize({width,height}); await page.emulateMedia({reducedMotion:'reduce'});
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    const listenerBaseline = await page.evaluate(() => (window as any).ownedListenerCount());
    for (let i=0;i<4;i++) {
      const notebook = i % 2 === 0;
      expect(await page.evaluate(async ({notebook,renderer}) => {
        const t = (window as any).mountTest;
        t.reader = t.mountReader(t.host, notebook ? t.createFieldNotebook() : t.baseline(), {renderer, chapter:notebook ? "log-day" : "a1", settings:{sound:false}});
        return t.reader.ready;
      }, {notebook,renderer})).toEqual({status:'ready'});
      await expect(page.locator('#readerNavigation')).toHaveCount(1);
      await expect(page.locator('#contentStatus')).toHaveCount(1);
      if (notebook) await expect(page.locator('[data-command="hud:settings"]')).toBeHidden();
      else await expect(page.locator('[data-command="hud:settings"]')).toBeVisible();
      // One key press must cause only the current instance's action.
      await page.keyboard.press('ArrowRight');
      await expect(page.locator(`#text-${notebook?'log-noon':'a2'}`)).toBeVisible();
      await page.evaluate(() => {
        const t = (window as any).mountTest;
        t.reader.destroy(); t.reader.destroy();
        try { t.reader.dispatch({type:'overview'}); } catch (error) { t.dispatchError = String(error); }
      });
      await expect(page.locator('#readerNavigation')).toHaveCount(0);
      await expect(page.locator('#contentStatus')).toHaveCount(0);
      await expect(page.locator('canvas')).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).ownedListenerCount())).toBe(listenerBaseline);
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => (window as any).mountTest.dispatchError)).toContain('destroyed');
    }
    expect(errors).toEqual([]);
  });
}

test('concurrent same-page mounts are rejected before changing either host; failed construction releases ownership', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const t = (window as any).mountTest;
    const first = t.mountReader(t.host,t.createFieldNotebook(),{renderer:'svg'}); await first.ready;
    const existing = t.host.querySelector('#readerNavigation');
    const other = document.createElement('div'); other.textContent='keep'; document.body.append(other);
    let failure=''; try { t.mountReader(other,t.baseline()); } catch(error) {failure=String(error);}
    const preserved = existing === t.host.querySelector('#readerNavigation') && other.textContent === 'keep';
    first.destroy(); other.remove();
    const sentinel = document.createElement('p'); sentinel.textContent='consumer'; t.host.replaceChildren(sentinel);
    const invalid=t.createFieldNotebook(); invalid.manifest.chapters[0].boundaryRoutes={next:'missing'};
    let invalidFailure=''; try {t.mountReader(t.host,invalid,{renderer:'svg'});} catch(error) {invalidFailure=String(error);}
    const rolledBack=t.host.firstChild === sentinel;
    const next=t.mountReader(t.host,t.baseline(),{renderer:'svg'});const ready=await next.ready;next.destroy();
    return {failure,preserved,invalidFailure,rolledBack,ready,restored:t.host.firstChild===sentinel};
  });
  expect(result.failure).toContain('one mounted reader'); expect(result.preserved).toBe(true);
  expect(result.invalidFailure).toContain('Unknown chapter'); expect(result.rolledBack).toBe(true);
  expect(result.ready).toEqual({status:'ready'}); expect(result.restored).toBe(true);
});

test('destroy during pending content aborts requests, settles ready and ignores late patches', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const t=(window as any).mountTest, definition=t.createFieldNotebook();
    const signals: AbortSignal[]=[]; let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve});
    definition.source={async *open(_id:string,_presentation:string,signal:AbortSignal){signals.push(signal);await pending;yield {type:'replace',text:'stale content'};}};
    const reader=t.mountReader(t.host,definition,{renderer:'svg'});
    await new Promise(resolve=>setTimeout(resolve,25));
    reader.destroy();reader.destroy();const outcome=await reader.ready;
    const next=t.mountReader(t.host,t.baseline(),{renderer:'svg'});release();await next.ready;
    const stale=document.body.textContent!.includes('stale content');next.destroy();
    return {outcome,opened:signals.length,aborted:signals.every(s=>s.aborted),stale};
  });
  expect(result.outcome).toEqual({status:'destroyed'});expect(result.opened).toBeGreaterThan(0);
  expect(result.aborted).toBe(true);expect(result.stale).toBe(false);
});

test('custom utility capabilities have reachable mobile search results without demo glyphs or root IDs', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await setup(page);
  expect(await page.evaluate(async()=>{
    const t=(window as any).mountTest, definition=t.createFieldNotebook();
    definition.manifest.definitions.find((h:any)=>h.id==='LOG').kind='settings';
    definition.manifest.definitions.find((h:any)=>h.id==='LOG').glyph='工具';
    definition.manifest.definitions.find((h:any)=>h.id==='FIND').glyph='找';
    t.reader=t.mountReader(t.host,definition,{renderer:'svg'});await t.reader.ready;
    return Object.keys(t.reader);
  })).toEqual(['ready','dispatch','destroy']);
  await page.locator('[data-command="hud:settings"]').click();await expect(page.locator('#text-log-start')).toBeVisible();
  await page.locator('[data-command="hud:search"]').click();await expect(page.locator('#text-find-start')).toBeVisible();
  const input=page.getByPlaceholder('搜索标题或正文…');
  await input.fill('unmatched-xyz');await expect(page.locator('.reader-count')).toContainText('0 项结果');
  await expect(page.locator('[data-command="hud:next"]')).toBeHidden();
  await input.fill('砖缝');await expect(page.locator('.reader-count')).toContainText('4 项结果');
  // The geometry can extend behind the global HUD; the named reading control is a safe tap target.
  await page.getByRole('button',{name:'查看结果 →',exact:true}).click();
  await expect(page.locator('#text-q_hit_obs-curb')).toBeVisible();
  await expect(page.locator('[data-command="hud:next"]')).toHaveText('下一节 →');
  await page.locator('[data-command="hud:next"]').click();
  await expect(page.locator('#text-q_hit_obs-mark')).toBeVisible();
  await page.evaluate(()=>(window as any).mountTest.reader.destroy());
});
