import { test, expect, type Page, type FrameLocator } from '@playwright/test';
const control = (frame: FrameLocator, command: string) => frame.locator(`[data-command="hud:${command}"]`);
async function open(page: Page, renderer='svg') {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`/dev/multi-reader.html?renderer=${renderer}`);
  const left=page.frameLocator('#primary iframe'), right=page.frameLocator('#notebook iframe');
  await expect(left.locator('#text-a1')).toBeVisible();await expect(right.locator('#text-obs-start')).toBeVisible();
  return {left,right};
}

test('same-page readers isolate styles, IDs, focused keyboard input, search and history', async ({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const {left,right}=await open(page);
  await expect(left.locator('html')).toHaveAttribute('data-theme','light');
  await expect(right.locator('html')).toHaveAttribute('data-theme','celadon');
  expect(await page.evaluate(()=>({theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,title:document.title})))
    .toEqual({theme:undefined,background:'rgb(238, 234, 226)',title:'Anallia · 并置阅读'});
  expect(await page.locator('#scene,#world,#readerNavigation').count()).toBe(0);
  await control(left,'next').click();await expect(left.locator('#text-a2')).toBeVisible();
  await page.keyboard.press('ArrowRight');await expect(left.locator('#text-a3')).toBeVisible();
  await expect(right.locator('#text-obs-start')).toBeVisible();
  await control(right,'enter').click();await expect(right.locator('#text-obs-walk')).toBeVisible();
  await page.keyboard.press('ArrowRight');await expect(right.locator('#text-obs-method')).toBeVisible();
  await expect(left.locator('#text-a3')).toBeVisible();
  await control(right,'search').click();await expect(right.locator('#text-find-start')).toBeVisible();
  await right.locator('.hub-search-input').fill('砖缝');
  await expect(right.locator('.reader-count')).toContainText('4 项结果');
  await control(right,'next').click();await expect(right.locator('#text-q_hit_obs-curb')).toBeVisible();
  await expect(left.locator('#text-a3')).toBeVisible();
  await control(right,'previous').click();await expect(right.locator('#text-find-start')).toBeVisible();
  await expect(right.locator('.hub-search-input')).toHaveValue('砖缝');
  await control(right,'back').click();await expect(right.locator('#text-obs-method')).toBeVisible();
  await expect(left.locator('html')).toHaveAttribute('data-theme','light');
  expect(errors).toEqual([]);
});

for (const renderer of ['svg','gpu']) test(`destroying and remounting one reader leaves the other's content and GPU intact (${renderer})`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const {right}=await open(page,renderer);
  await right.locator('#text-obs-start [data-target="log-day"]').click();await expect(right.locator('#text-log-day')).toBeVisible();
  if(renderer==='gpu')await expect(right.locator('#scene')).toHaveAttribute('data-renderer','webgl');
  const frameIdentity=await page.locator('#notebook iframe').evaluate(frame=>{(window as any).retainedFrame=frame;return true;});
  expect(frameIdentity).toBe(true);
  for(let i=0;i<3;i++){
    await page.locator('#toggle-primary').click();await expect(page.locator('#primary iframe')).toHaveCount(0);
    await expect.poll(()=>page.frames().length).toBe(2);
    await page.keyboard.press('ArrowRight');
    await expect(right.locator('#text-log-day')).toBeVisible();
    await control(right,'morph').click();
    await expect(right.locator('#text-log-day')).toHaveAttribute('data-presentation',i%2===0?'circle':'line');
    await page.locator('#toggle-primary').click();await expect(page.frameLocator('#primary iframe').locator('#text-a1')).toBeVisible();
    await expect(right.locator('#text-log-day')).toBeVisible();
    expect(await page.locator('#notebook iframe').evaluate(frame=>frame===(window as any).retainedFrame)).toBe(true);
    await expect.poll(()=>page.frames().length).toBe(3);
  }
  await control(right,'overview').click();await expect(right.locator('#readerNavigation')).toHaveAttribute('data-location','overview');
  await control(right,'back').click();await expect(right.locator('#text-log-day')).toBeVisible();
  expect(errors).toEqual([]);
});

test('container resize, offset pointer input and narrow touch remain local',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  try{
    const page=await context.newPage();const {left,right}=await open(page);
    await page.locator('.work-switch a[href="#notebook-region"]').tap();
    await control(right,'enter').tap();await expect(right.locator('#text-obs-walk')).toBeVisible();
    await expect(left.locator('#text-a1')).toBeVisible();
    const rightSize=await right.locator('body').evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.locator('#primary').evaluate(host=>{host.style.height='620px';host.style.width='90%';});
    await expect.poll(()=>left.locator('body').evaluate(()=>innerHeight)).toBe(618);
    expect(await right.locator('body').evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual(rightSize);
    await page.locator('.work-switch a[href="#primary-region"]').tap();
    await control(left,'overview').tap();await expect(left.locator('#readerNavigation')).toHaveAttribute('data-location','overview');
    await control(left,'map-toggle').tap();await expect(left.locator('#readerNavigation')).toHaveAttribute('data-map-panel','collapsed');
    await control(left,'map-toggle').tap();await control(left,'hub:B').tap();
    await expect(left.locator('#text-b0')).toBeVisible();
    await expect(right.locator('#text-obs-walk')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight)).toBe(true);
  }finally{await context.close();}
});

test('destroy aborts each realm, releases clocks/listeners/audio, and ignores old async patches',async({page})=>{
  await page.addInitScript(()=>{
    const pending=new Set<number>();const request=window.requestAnimationFrame.bind(window), cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>{const id=request(time=>{pending.delete(id);callback(time)});pending.add(id);return id;};
    window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id)};
    const events:{target:EventTarget,type:string,listener:unknown,capture:boolean,active:boolean}[]=[];
    const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener=function(type,listener,options){
      const capture=typeof options==='boolean'?options:!!options?.capture;
      if((this===window||this===document)&&['keydown','resize','visibilitychange','pointermove','pointerup','pointercancel','pagehide'].includes(type)){
        const record={target:this,type,listener,capture,active:true};events.push(record);
        if(typeof options==='object'&&options?.signal){record.active=!options.signal.aborted;add.call(options.signal,'abort',()=>{record.active=false},{once:true});}
      }
      return add.call(this,type,listener,options);
    };
    EventTarget.prototype.removeEventListener=function(type,listener,options){
      const capture=typeof options==='boolean'?options:!!options?.capture;
      for(const r of events)if(r.target===this&&r.type===type&&r.listener===listener&&r.capture===capture)r.active=false;
      return remove.call(this,type,listener,options);
    };
    const audio:AudioContext[]=[];const Audio=window.AudioContext;
    if(Audio)window.AudioContext=class extends Audio{constructor(...args:ConstructorParameters<typeof AudioContext>){super(...args);audio.push(this)}};
    (window as any).resources=()=>({raf:pending.size,listeners:events.filter(r=>r.active).length,audio:audio.map(a=>a.state)});
  });
  await open(page);
  await page.locator('#toggle-primary').click();await page.locator('#toggle-notebook').click();
  const result=await page.evaluate(async()=>{
    const {mountEmbeddedReader}=await import('/src/embedded-reader.ts');
    const {createFieldNotebook}=await import('/src/examples/field-notebook.ts');
    const host=document.getElementById('primary')!;const baseline=(window as any).resources();
    const signals:AbortSignal[]=[];let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
    const definition=createFieldNotebook();definition.source={async *open(_id:string,_presentation:string,signal:AbortSignal){signals.push(signal);await pending;yield {type:'replace',text:'late abandoned frame'};}};
    const first=mountEmbeddedReader(host,definition,{frameUrl:'/reader-frame.html',renderer:'svg'});
    await new Promise<void>(resolve=>{const check=()=>signals.length?resolve():setTimeout(check,10);check()});
    const old=host.querySelector('iframe')!.contentWindow as any;
    first.destroy();first.destroy();const outcome=await first.ready;const oldResources=old.resources();
    const second=mountEmbeddedReader(host,createFieldNotebook(),{frameUrl:'/reader-frame.html',renderer:'svg'});release();await second.ready;
    const current=host.querySelector('iframe')!.contentWindow as any;
    const stale=current.document.body.textContent.includes('late abandoned frame');
    // Actual gesture unlocks this realm's audio before destruction.
    (window as any).resourceTest={second,current,baseline};
    return {outcome,oldResources,aborted:signals.every(s=>s.aborted),stale};
  });
  expect(result).toEqual({outcome:{status:'destroyed'},oldResources:{raf:0,listeners:0,audio:[]},aborted:true,stale:false});
  await control(page.frameLocator('#primary iframe'),'enter').click();
  await page.evaluate(()=>{const t=(window as any).resourceTest;t.second.destroy();t.second.destroy();});
  await expect.poll(()=>page.evaluate(()=>(window as any).resourceTest.current.resources())).toEqual({raf:0,listeners:0,audio:['closed']});
  expect(await page.evaluate(()=>(window as any).resources())).toEqual(await page.evaluate(()=>(window as any).resourceTest.baseline));
});

test('cancel-before-load and failed frame entry restore hosts; duplicate hosts and foreign URLs fail safely',async({page})=>{
  await open(page);await page.locator('#toggle-primary').click();
  const result=await page.evaluate(async()=>{
    const {mountEmbeddedReader}=await import('/src/embedded-reader.ts');const {createFieldNotebook}=await import('/src/examples/field-notebook.ts');
    const host=document.getElementById('primary')!, sentinel=host.firstChild;
    const def=createFieldNotebook();const first=mountEmbeddedReader(host,def,{frameUrl:'/reader-frame.html'});
    let duplicate='',foreign='';try{mountEmbeddedReader(host,def,{frameUrl:'/reader-frame.html'})}catch(error){duplicate=String(error)}
    first.destroy();const cancelled=await first.ready;
    const reentrant=createFieldNotebook();
    reentrant.source={async *open(){during.destroy();yield {type:'replace',text:'discarded'};}};
    const during=mountEmbeddedReader(host,reentrant,{frameUrl:'/reader-frame.html',renderer:'svg'});
    const destroyedDuringOpen=await during.ready;
    try{mountEmbeddedReader(host,def,{frameUrl:'https://example.invalid/frame.html'})}catch(error){foreign=String(error)}
    const malformed=mountEmbeddedReader(host,def,{frameUrl:'/dev/loading.html'});
    let malformedError='';try{await malformed.ready}catch(error){malformedError=String(error)}
    const restored=host.firstChild===sentinel;
    const next=mountEmbeddedReader(host,createFieldNotebook(),{frameUrl:'/reader-frame.html',renderer:'svg'});const outcome=await next.ready;next.destroy();
    return {duplicate,foreign,cancelled,destroyedDuringOpen,malformedError,restored,outcome};
  });
  expect(result.duplicate).toContain('already has');expect(result.foreign).toContain('same-origin');
  expect(result.cancelled).toEqual({status:'destroyed'});expect(result.destroyedDuringOpen).toEqual({status:'destroyed'});expect(result.malformedError).toContain('expected mount entry');
  expect(result.restored).toBe(true);expect(result.outcome).toEqual({status:'ready'});
  await expect(page.frameLocator('#notebook iframe').locator('#text-obs-start')).toBeVisible();
});
