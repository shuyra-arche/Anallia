import type { RenderSample } from "../../src/core/render-profile.ts";
import { summarizeRenderProfiles } from "../helpers/render-profile.ts";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

async function startCpuSampling(page: Page, info: TestInfo, renderer: string): Promise<() => Promise<void>> {
  if (process.env.SHUYRA_CPU_PROFILE !== "1") return async () => {};
  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 1000 });
  await session.send("Profiler.start");
  return async () => {
    try {
      const { profile } = await session.send("Profiler.stop");
      const path = info.outputPath(`cpu-${renderer}.cpuprofile`);
      await writeFile(path, JSON.stringify(profile));
      await info.attach(`cpu-${renderer}.cpuprofile`, { path, contentType: "application/json" });
    } finally { await session.detach(); }
  };
}

for (const renderer of ["auto", "svg", "gpu"]) {
  test(`100000-character stream and route performance (${renderer})`, async ({ page }, testInfo) => {
    test.skip(process.env.SHUYRA_PERF !== "1", "Opt-in measurement with a fixed resource envelope");
    test.setTimeout(55_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/?chapter=m3&renderer=${renderer}`);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(() => (window as any).__shuyra.ready);
    await page.waitForFunction(() => !(window as any).__shuyra.field.isAnimating);
    const stopCpuSampling = await startCpuSampling(page, testInfo, renderer);
    const result = await page.evaluate(async () => {
      const app = (window as any).__shuyra;
      await document.fonts.ready;
      app.field.state.settings.frameRate = 60;
      app.field.state.settings.background = "flow";
      const percentile = (values: number[], quantile: number) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
      };
      const probe = document.querySelector<HTMLCanvasElement>('canvas[data-renderer="webgl"]') ?? document.createElement("canvas");
      const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      const gpu = gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unknown";
      const routeIntervals: number[] = [], routeRenders: number[] = [];
      const routeProfiles: RenderSample[] = [], streamProfiles: RenderSample[] = [];
      let profileSamples = routeProfiles, profileDropped = 0;
      app.scene.setRenderProfiler((sample: RenderSample) => {
        if (profileSamples.length < 10000) profileSamples.push(sample);
        else profileDropped++;
      });
      const originalRender = app.scene.render.bind(app.scene);
      app.scene.render = (state: any) => { const start = performance.now(); const result = originalRender(state); routeRenders.push(performance.now() - start); return result; };
      await new Promise<void>(resolve => {
        const start = performance.now();
        let previous = start, lastToggle = start;
        const frame = (now: number) => {
          routeIntervals.push(now - previous); previous = now;
          if (now - lastToggle >= 1500) { app.field.dispatch({ type: "morph" }); lastToggle = now; }
          if (now - start < 30_000) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
      app.scene.render = originalRender;
      app.scene.setRenderProfiler(null);
      if (app.field.hub.targetMorph < 0.5) app.field.dispatch({ type: "morph" });
      while (app.field.isAnimating) await new Promise(requestAnimationFrame);
      app.field.pan({ x: 0, y: 0 }, app.field.state.camera);
      app.field.state.settings.background = "none";
      const digits = "零一二三四五六七八九";
      const text = Array.from({ length: 500 }, (_, i) => {
        const prefix = `第${String(i).split("").map(d => digits[Number(d)]).join("")}段`;
        return (prefix + "正文示例".repeat(50)).slice(0, 200);
      }).join("\n\n");
      const packets: ({ type: "append" | "replace"; text: string } | null)[] = [];
      let waiter: ((patch: { type: "append" | "replace"; text: string } | null) => void) | null = null;
      const next = () => packets.length ? Promise.resolve(packets.shift()!) : new Promise<{ type: "append" | "replace"; text: string } | null>(resolve => { waiter = resolve; });
      const push = (patch: { type: "append" | "replace"; text: string } | null) => { if (waiter) { const resolve = waiter; waiter = null; resolve(patch); } else packets.push(patch); };
      const commits: number[] = [], streamIntervals: number[] = [];
      let contentTime = 0, pending = false, active = true, maxDrift = 0;
      let bookmark: Range | null = null, bookmarkNode: Node | null = null, baseline: number | null = null;
      const originalFlush = app.reading.flush.bind(app.reading);
      const originalSync = app.scene.articleRenderer.syncArticle.bind(app.scene.articleRenderer);
      const originalEstimate = app.scene.articleRenderer.estimateArticleHeight.bind(app.scene.articleRenderer);
      const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
      app.reading.flush = (now: number) => {
        const start = performance.now(), changes = originalFlush(now);
        if (active && changes.some((change: any) => change.id === "m3" && change.presentation === "line")) {
          pending = true; contentTime = performance.now() - start;
        }
        return changes;
      };
      app.scene.articleRenderer.syncArticle = (...args: any[]) => {
        const start = performance.now(), result = originalSync(...args);
        if (active && pending && args[1].id === "m3") contentTime += performance.now() - start;
        return result;
      };
      app.scene.articleRenderer.estimateArticleHeight = (...args: any[]) => {
        const start = performance.now(), result = originalEstimate(...args);
        if (active && pending && args[1].id === "m3") contentTime += performance.now() - start;
        return result;
      };
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", { ...height, get() {
        const start = performance.now(), value = height.get!.call(this);
        if (active && pending && this.classList.contains("note-content") && this.closest("#text-m3")) contentTime += performance.now() - start;
        return value;
      } });
      app.scene.render = (state: any) => {
        const result = originalRender(state);
        if (active && pending) { commits.push(contentTime); pending = false; }
        if (bookmark && baseline !== null) maxDrift = Math.max(maxDrift, Math.abs(bookmark.getBoundingClientRect().top - baseline));
        return result;
      };
      profileSamples = streamProfiles;
      app.scene.setRenderProfiler((sample: RenderSample) => {
        if (profileSamples.length < 10000) profileSamples.push(sample);
        else profileDropped++;
      });
      app.useContentSource({ async *open(id: string, presentation: string, signal: AbortSignal) {
        if (id !== "m3" || presentation !== "line") { yield { type: "replace", text: app.field.catalog.get(id).expressions[presentation] }; return; }
        signal.addEventListener("abort", () => push(null), { once: true });
        for (;;) { const patch = await next(); if (!patch || signal.aborted) return; yield patch; }
      } });
      await new Promise<void>(resolve => {
        let cursor = 0, frames = 0, previous = performance.now();
        const frame = (now: number) => {
          streamIntervals.push(now - previous); previous = now; frames++;
          if (frames === 35) {
            const paragraph = document.querySelector("#text-m3 p:nth-of-type(11)")!;
            bookmarkNode = paragraph.firstChild!;
            bookmark = document.createRange(); bookmark.setStart(bookmarkNode, 0); bookmark.setEnd(bookmarkNode, 1);
            const windowBounds = document.querySelector("#text-m3 .note-window")!.getBoundingClientRect();
            const desired = windowBounds.top + Math.min(120, windowBounds.height / 2);
            const offset = app.field.hub.textOffset + (bookmark.getBoundingClientRect().top - desired) / app.field.state.camera.z;
            app.field.hub.textOffset = app.field.hub.textOffsetTarget = Math.max(0, offset);
          }
          if (frames === 39 && bookmark) baseline = bookmark.getBoundingClientRect().top;
          if (cursor < text.length) { push({ type: cursor === 0 ? "replace" : "append", text: text.slice(cursor, cursor + 1024) }); cursor += 1024; requestAnimationFrame(frame); }
          else { push(null); resolve(); }
        };
        requestAnimationFrame(frame);
      });
      while (!app.store.get("m3", "line").complete) await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      active = false;
      app.scene.setRenderProfiler(null);
      app.reading.flush = originalFlush;
      app.scene.articleRenderer.syncArticle = originalSync;
      app.scene.articleRenderer.estimateArticleHeight = originalEstimate;
      app.scene.render = originalRender;
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
      return {
        at: new Date().toISOString(), browser: navigator.userAgent, gpu,
        softwareGpu: /SwiftShader|llvmpipe|softpipe|software/i.test(gpu),
        requestedRenderer: new URLSearchParams(location.search).get("renderer"), renderer: app.scene.rendererKind, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
        resourceEnvelope: "tools/browser-test.mjs", build: "Vite development", hanCharacters: 100000,
        profileVersion: 1, profileDropped,
        route: { seconds: 30, samples: routeIntervals.length, intervalP95: percentile(routeIntervals, 0.95), renderP95: percentile(routeRenders, 0.95) },
        stream: { samples: commits.length, intervalP95: percentile(streamIntervals, 0.95), commitP95: percentile(commits, 0.95), maxDrift, stableNodeConnected: bookmarkNode?.isConnected, complete: app.store.get("m3", "line").complete, sourceLength: app.store.get("m3", "line").text.length },
        raw: { routeIntervals, routeRenders, streamIntervals, commits, routeProfiles, streamProfiles },
      };
    }).finally(stopCpuSampling);
    const measured = {
      ...result,
      cpuSampling: process.env.SHUYRA_CPU_PROFILE === "1",
      route: { ...result.route, profile: summarizeRenderProfiles(result.raw.routeProfiles) },
      stream: { ...result.stream, profile: summarizeRenderProfiles(result.raw.streamProfiles) },
    };
    const report = testInfo.outputPath(`performance-${renderer}.json`);
    await writeFile(report, JSON.stringify(measured, null, 2));
    await testInfo.attach(`performance-${renderer}.json`, { path: report, contentType: "application/json" });
    const { raw: _, ...summary } = measured;
    const compact = (profile: ReturnType<typeof summarizeRenderProfiles>) => {
      const { full, cached, slowFrames: _, ...overall } = profile;
      return { ...overall, fullSamples: full.samples, cachedSamples: cached.samples };
    };
    console.info(JSON.stringify({
      ...summary,
      route: { ...summary.route, profile: compact(summary.route.profile) },
      stream: { ...summary.stream, profile: compact(summary.stream.profile) },
    }));
    expect(errors).toEqual([]);
    expect(result.profileDropped).toBe(0);
    for (const samples of [result.raw.routeProfiles, result.raw.streamProfiles]) {
      expect(samples.length).toBeGreaterThan(20);
      for (const sample of samples) {
        const sum = Object.values(sample.stages).reduce((sum, ms) => sum + ms!, 0);
        expect(Math.abs(sum - sample.total)).toBeLessThan(0.001);
        expect(Object.values(sample.stages).every(ms => Number.isFinite(ms) && ms! >= 0)).toBe(true);
      }
    }
    expect(measured.route.profile.stages["scene.geometry"]?.samples).toBeGreaterThan(0);
    expect(measured.stream.profile.stages["scene.reading"]?.samples).toBeGreaterThan(0);
    if (result.renderer === "webgl") {
      expect(measured.route.profile.stages["gpu.submit"]?.samples).toBeGreaterThan(0);
      expect(measured.route.profile.stages["gpu.labels"]?.samples).toBeGreaterThan(0);
    } else expect(measured.route.profile.stages["svg.render"]?.samples).toBeGreaterThan(0);
    expect(result.stream.complete).toBe(true);
    expect(result.stream.sourceLength).toBe(100998);
    expect(result.stream.samples).toBeGreaterThan(20);
    expect(result.stream.stableNodeConnected).toBe(true);
    expect(result.stream.maxDrift).toBeLessThanOrEqual(2);
  });
}
