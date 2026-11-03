import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "anallia-consumer-"));
const consumer = join(temporary, "nested", "consumer");
const evidence = process.env.ANALLIA_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const requests = [],
  failures = [],
  errors = [],
  checks = [];
let server, browser;
try {
  await cp(join(root, "examples/consumer"), consumer, { recursive: true });
  await cp(join(root, "dist-reader"), join(consumer, "vendor/anallia"), {
    recursive: true,
  });
  await writeFile(
    join(consumer, "consumer.ts"),
    `
import { mountReader, type ReaderDefinition, type ReaderOptions } from './vendor/anallia/document.js';
import { mountEmbeddedReader, type EmbeddedReaderOptions } from './vendor/anallia/embedded.js';
import { createGeometryReader, createFieldNotebook } from './vendor/anallia/examples.js';
import { buildStaticReader, ContentBuildError, type StaticReaderInput } from './vendor/anallia/content.js';
const author: StaticReaderInput = { entry: 'start', hubs: [{ id: 'NOTES' }], chapters: [{ id: 'start', hub: 'NOTES', title: 'Start', body: 'Body' }] };
const built: ReaderDefinition = buildStaticReader(author); void built; void ContentBuildError;
// @ts-expect-error Both explicit presentations are required.
const badBody: StaticReaderInput['chapters'][number]['body'] = { circle: 'only' };
void badBody;
const definition: ReaderDefinition = createGeometryReader();
const options: ReaderOptions = { renderer: 'svg', settings: { sound: false } };
const embedded: EmbeddedReaderOptions = { ...options, frameUrl: './vendor/anallia/reader-frame.html' };
const host = document.createElement('div');
const reader = mountReader(host, definition, options);
const second = mountEmbeddedReader(host, createFieldNotebook(), embedded);
reader.dispatch({ type: 'overview' });
second.ready.then(result => { if (result.status === 'ready') second.dispatch({ type: 'morph' }); });
const stop = reader.subscribe(state => {
  if (state.status === 'active') {
    const chapter: string = state.location.chapter;
    void chapter;
    // @ts-expect-error Public state is deeply readonly.
    state.location.chapter = 'mutated';
  }
});
stop();
const saved = reader.snapshot();
if (saved) {
  const resumed: ReaderOptions = { restore: saved };
  void resumed;
  // @ts-expect-error Portable snapshot locations are readonly too.
  saved.location.hub = 'mutated';
}
// @ts-expect-error Mutable application state is not a public handle member.
reader.field;
reader.destroy(); second.destroy();
`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        allowJs: true,
        checkJs: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: [],
        skipLibCheck: false,
        noUncheckedSideEffectImports: true,
      },
      files: ["consumer.ts", "custom-content.js"],
    }),
  );
  const types = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      join(consumer, "tsconfig.json"),
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  assert.equal(types.status, 0, types.stdout + types.stderr);
  checks.push(
    "Standalone TypeScript consumer resolves declarations without node_modules or source files",
  );
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    if (pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    requests.push(pathname);
    const file = resolve(
      temporary,
      "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
    );
    if (!file.startsWith(temporary + "/")) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
        }[extname(file)] ?? "application/octet-stream",
      );
      res.end(data);
    } catch {
      failures.push(pathname);
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`,
    base = origin + "/nested/consumer/";
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    if (
      !route
        .request()
        .url()
        .startsWith(origin + "/")
    ) {
      failures.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  let left = page.frameLocator("#geometry iframe"),
    right = page.frameLocator("#notebook iframe");
  await left.locator("#text-a0").waitFor({ state: "visible" });
  await right.locator("#text-obs-start").waitFor({ state: "visible" });
  const exports = await page.evaluate(async () => ({
    embedded: Object.keys(await import("./vendor/anallia/embedded.js")).sort(),
    document: Object.keys(await import("./vendor/anallia/document.js")).sort(),
    examples: Object.keys(await import("./vendor/anallia/examples.js")).sort(),
    content: Object.keys(await import("./vendor/anallia/content.js")).sort(),
  }));
  assert.deepEqual(exports, {
    embedded: ["mountEmbeddedReader"],
    document: ["mountReader"],
    examples: ["createFieldNotebook", "createGeometryReader", "createStaticFieldNotebook"],
    content: ["ContentBuildError", "buildStaticReader"],
  });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(250, 244, 233)",
  );
  await left.locator('[data-command="hud:enter"]').click();
  await left.locator("#text-a1").waitFor({ state: "visible" });
  await right.locator('[data-command="hud:enter"]').click();
  await right.locator("#text-obs-walk").waitFor({ state: "visible" });
  await page.locator("#toggle-geometry").click();
  await right.locator('[data-command="hud:morph"]').click();
  await right
    .locator('#text-obs-walk[data-presentation="line"]')
    .waitFor({ state: "visible" });
  await page.locator("#toggle-geometry").click();
  await left.locator("#text-a0").waitFor({ state: "visible" });
  await right
    .locator('#text-obs-walk[data-presentation="line"]')
    .waitFor({ state: "visible" });
  if (evidence)
    await page.screenshot({ path: join(evidence, "consumer-desktop.png") });
  checks.push(
    "Both existing contents mount independently from copied ESM under a nested URL; single-side remount preserves the other",
  );
  await page.goto(base + "document.html?renderer=webgl");
  await page
    .locator('#scene[data-renderer="webgl"] #text-a0')
    .waitFor({ state: "visible" });
  await page.locator('[data-command="hud:enter"]').click();
  await page.locator("#text-a1").waitFor({ state: "visible" });
  await page.goto(base + "document.html?example=notebook");
  await page.locator("#text-obs-start").waitFor({ state: "visible" });
  await page.locator('[data-command="hud:enter"]').click();
  await page.locator("#text-obs-walk").waitFor({ state: "visible" });
  checks.push(
    "Document entry, explicit stylesheet, default WebGL and notebook SVG work without app shell",
  );
  const before = requests.length;
  await page.goto(base + "document.html?example=custom");
  await page.locator("#text-start").waitFor({ state: "visible" });
  await page.locator('[data-command="hud:enter"]').click();
  await page.locator("#text-detail").waitFor({ state: "visible" });
  await page.locator('[data-command="hud:back"]').click();
  await page.locator("#text-start").waitFor({ state: "visible" });
  await page.locator('[data-command="hud:morph"]').click();
  await page
    .locator('#text-start[data-presentation="line"]')
    .waitFor({ state: "visible" });
  assert.equal(
    requests.slice(before).some((path) => path.endsWith("/examples.js")),
    false,
  );
  if (evidence)
    await page.screenshot({ path: join(evidence, "consumer-custom.png") });
  checks.push(
    "The complete custom-content quickstart works without loading either bundled example",
  );
  await writeFile(join(consumer, "session.html"), '<!doctype html><link rel="stylesheet" href="./vendor/anallia/styles.css"><div id="scene"></div>');
  for (const example of ["custom", "notebook"]) {
    await page.goto(base + "session.html");
    await page.evaluate(async example => {
      const { mountReader } = await import("./vendor/anallia/document.js");
      const create = example === "custom" ? (await import("./custom-content.js")).createCustomReader
        : (await import("./vendor/anallia/examples.js")).createStaticFieldNotebook;
      const definition = create();
      window.sessionProbe = { mountReader, create, host: document.getElementById("scene"),
        chapter: example === "custom" ? "detail" : "log-day", searchRoot: definition.manifest.definitions.find(hub => hub.kind === "search").root };
      const t = window.sessionProbe;
      t.reader = mountReader(t.host, definition, { renderer: "svg", chapter: t.chapter, settings: { sound: false } });
      t.events = []; t.reader.subscribe(state => t.events.push(state));
      await t.reader.ready;
    }, example);
    await page.waitForFunction(() => window.sessionProbe.reader.snapshot() !== null);
    await page.evaluate(() => {
      const t = window.sessionProbe; t.saved = JSON.parse(JSON.stringify(t.reader.snapshot()));
      t.reader.dispatch({ type: "navigate", target: t.searchRoot });
    });
    await page.locator('.hub-search-input').fill(example === "custom" ? "第二页" : "砖缝");
    await page.locator('[data-command="hud:next"]').click();
    await page.locator('article[id^="text-q_hit_"]:not([hidden])').first().waitFor({state: "visible"});
    await page.evaluate(() => {
      const t = window.sessionProbe; t.reader.destroy();
      t.reader = t.mountReader(t.host, t.create(), { renderer: "svg", restore: t.saved, settings: { sound: false } });
    });
    await page.waitForFunction(() => window.sessionProbe.reader.getState().restoration === "matched");
    assert.deepEqual(await page.evaluate(() => {
      const t = window.sessionProbe;
      return { sameLocation: JSON.stringify(t.saved.location) === JSON.stringify(t.reader.getState().location),
        terminal: t.events.at(-1).status, frozen: Object.isFrozen(t.reader.getState().location) };
    }), { sameLocation: true, terminal: "destroyed", frozen: true });
  }
  checks.push("Both authored static consumers support generated search indexes and serialized session restore through compiled public entries");
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await phoneContext.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : (failures.push(route.request().url()), route.abort()),
  );
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(base);
  right = phone.frameLocator("#notebook iframe");
  await right.locator("#text-obs-start").waitFor({ state: "visible" });
  await phone.locator('a[href="#notebook-region"]').tap();
  await right.locator('[data-command="hud:enter"]').tap();
  await right.locator("#text-obs-walk").waitFor({ state: "visible" });
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  if (evidence)
    await phone.screenshot({ path: join(evidence, "consumer-phone.png") });
  checks.push(
    "Independent mobile consumer accepts touch and has no horizontal overflow",
  );
  assert.equal(
    requests.some((path) => /\/(src|node_modules|@vite)\//.test(path)),
    false,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const report = {
    checks,
    exports,
    sourceTreeAvailable: false,
    packageManagerRequiredByConsumer: false,
    errors,
    failedRequests: failures,
    requestCount: requests.length,
  };
  if (evidence)
    await writeFile(
      join(evidence, "consumer-validation.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
