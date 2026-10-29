import { expect, test } from "@playwright/test";
import type { RenderSample } from "../../src/core/render-profile.ts";

for (const renderer of ["svg", "gpu"]) {
  test(`exclusive profile stages cover full, cached and background-only frames (${renderer})`, async ({ page }) => {
    await page.goto(`/?renderer=${renderer}`);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(() => (window as any).__shuyra.ready);
    await page.evaluate(async () => {
      await document.fonts.ready;
      (window as any).__shuyra.field.state.settings.background = "flow";
    });
    await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating && !(window as any).__shuyra.scene.isAnimating);
    const samples = await page.evaluate(() => {
      const app = (window as any).__shuyra;
      const samples: RenderSample[] = [];
      app.scene.setHoveredTarget("a1");
      app.scene.setRenderProfiler((sample: RenderSample) => samples.push(sample));
      app.scene.render(app.field.state);
      app.scene.render(app.field.state);
      app.field.state.elapsed += 80;
      app.scene.render(app.field.state);
      app.scene.setHoveredTarget(null);
      app.scene.render(app.field.state);
      app.scene.setRenderProfiler(null);
      app.scene.render(app.field.state);
      return samples;
    });
    expect(samples.map(sample => sample.path)).toEqual(["full", "cached", "cached", "full"]);
    expect(samples.every(sample => sample.renderer === (renderer === "gpu" ? "webgl" : "svg"))).toBe(true);
    for (const sample of samples) {
      const durations = Object.values(sample.stages) as number[];
      expect(durations.every(ms => Number.isFinite(ms) && ms >= 0)).toBe(true);
      expect(Math.abs(durations.reduce((sum, ms) => sum + ms, 0) - sample.total)).toBeLessThan(0.001);
    }
    expect(samples[0].stages["scene.reading"]).toBeDefined();
    expect(samples[1].stages["scene.reading"]).toBeUndefined();
    if (renderer === "gpu") {
      expect(samples[0].stages["gpu.labels"]).toBeDefined();
      expect(samples[0].stages["gpu.submit"]).toBeDefined();
      expect(samples[1].stages["gpu.submit"]).toBeUndefined();
      expect(samples[2].stages["gpu.background"]).toBeDefined();
      expect(samples[2].stages["gpu.submit"]).toBeDefined();
      expect(samples[2].stages["gpu.labels"]).toBeUndefined();
    } else expect(samples[0].stages["svg.render"]).toBeDefined();
  });
}


test("default and unrecognized renderer parameters use SVG without creating a GPU canvas", async ({ page }) => {
  for (const suffix of ["", "?renderer=unknown"]) {
    await page.goto(`/${suffix}`);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(() => (window as any).__shuyra.ready);
    expect(await page.evaluate(() => (window as any).__shuyra.scene.rendererKind)).toBe("svg");
    await expect(page.locator('canvas[data-renderer="webgl"]')).toHaveCount(0);
    await expect(page.locator("#text-a0")).toBeVisible();
  }
});


test("offscreen GPU dashes match full-path pixels and rebuild clipping for camera and viewport changes", async ({ page }) => {
  await page.goto("/?renderer=gpu");
  await page.waitForFunction(() => Boolean((window as any).__shuyra));
  await page.evaluate(() => (window as any).__shuyra.ready);
  const result = await page.evaluate(() => {
    const app=(window as any).__shuyra, gpu=app.scene.gpu;
    const viewport={...app.scene.frame.viewport};
    let revision=app.scene.frame.revision+100;
    const make=(offset=0,width=viewport.width) => ({
      ...app.scene.frame,revision:revision++,viewport:{...viewport,width},camera:{x:offset,y:0,z:1,rotation:0},
      background:null,portal:null,masks:[],labels:[],reading:[],layers:[{id:"relations",order:40,primitives:[{
        type:"polyline",points:[{x:-12000-offset,y:200},{x:12000-offset,y:200}],stroke:"#ff0000",strokeWidth:1.5,opacity:1,dash:[4,6],
      }]}],
    });
    const graphic=()=>gpu.graphicsPools.get(gpu.layerRoots.get("relations"))[0];
    const data=()=>graphic().context._gpuData[gpu.renderer.uid].geometryData;
    const pixels=()=>{
      const gl=gpu.renderer.gl, out=new Uint8Array(gpu.canvas.width*gpu.canvas.height*4);
      gl.readPixels(0,0,gpu.canvas.width,gpu.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,out);
      return out;
    };
    gpu.render(make());
    const clippedVertices=data().vertices.length/2, before=pixels();
    const clip=gpu.dashClip.bind(gpu);
    gpu.dashClip=()=>null; gpu.primitiveRecords.delete(graphic());
    gpu.render(make());
    const fullVertices=data().vertices.length/2, reference=pixels();
    let active=0,different=0,maxDiff=0;
    for(let i=0;i<before.length;i+=4) {
      if (!before[i+3]&&!reference[i+3]) continue;
      active++;
      let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(before[i+c]-reference[i+c]));
      maxDiff=Math.max(maxDiff,delta); if(delta>8)different++;
    }
    gpu.dashClip=clip; gpu.primitiveRecords.delete(graphic());
    gpu.render(make());
    const start=gpu.geometryStats.builds;
    gpu.render(make(20));
    gpu.resize(viewport.width+120,viewport.height);
    gpu.render(make(20,viewport.width+120));
    const xs=data().vertices.filter((_:number,i:number)=>i%2===0);
    return {clippedVertices,fullVertices,active,different,maxDiff,additionalBuilds:gpu.geometryStats.builds-start,
      minX:Math.min(...xs),maxX:Math.max(...xs),width:viewport.width+120};
  });
  expect(result.clippedVertices).toBeLessThan(result.fullVertices/4);
  expect(result.active).toBeGreaterThan(100);
  expect(result.different/result.active).toBeLessThanOrEqual(0.02);
  expect(result.maxDiff).toBeLessThanOrEqual(8);
  expect(result.additionalBuilds).toBe(2);
  expect(result.minX).toBeGreaterThanOrEqual(-10);
  expect(result.maxX).toBeLessThanOrEqual(result.width+10);
});
