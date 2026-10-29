import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const exportsRoot = process.env.SHUYRA_EXPORT_ROOT;
let server: Server, origin: string;
test.beforeAll(async () => {
  if (!exportsRoot) return;
  server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url!, "http://localhost").pathname);
      const prefix = path.startsWith("/Anallia/") ? "/Anallia/" : path.startsWith("/preview/") ? "/preview/" : "/";
      const root = prefix === "/preview/" ? resolve("preview") : resolve(exportsRoot, prefix === "/Anallia/" ? "pages" : "normal");
      const file = resolve(root, path.slice(prefix.length) || "index.html");
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(file);
      const type = ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css" } as Record<string, string>)[extname(file)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }); response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No export verification address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

for (const form of ["normal", "pages", "preview", "single-file"]) {
  test(`production ${form} serves bundled content without development hooks`, async ({ page }) => {
    test.skip(!exportsRoot, "Build all export forms and set SHUYRA_EXPORT_ROOT");
    const errors: string[] = [], requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const base = form === "single-file" ? pathToFileURL(resolve("demo.html")).href : origin + (form === "pages" ? "/Anallia/" : form === "preview" ? "/preview/" : "/");
    if (form === "single-file") await page.context().setOffline(true);
    const renderer = form === "single-file" ? "auto" : "gpu";
    await page.goto(`${base}?renderer=${renderer}`);
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(() => (window as any).__shuyra.ready);
    await expect(page.locator("#text-a0")).toBeVisible();
    if (renderer === "gpu") expect(await page.evaluate(() => (window as any).__shuyra.scene.rendererKind)).toBe("webgl");
    expect(await page.evaluate(() => typeof (window as any).__shuyra.useContentSource)).toBe("undefined");
    await expect(page.locator("#loadingOverlay")).toHaveCount(0);
    await page.locator('#text-a0 [data-target="a1"]').first().click();
    await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "a1");
    await page.evaluate(() => (window as any).__shuyra.field.dispatch({ type: "navigate", target: "m3" }));
    await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "m3" && !(window as any).__shuyra.field.isAnimating);
    await expect(page.locator("#text-m3")).toBeVisible();
    expect(errors).toEqual([]);
    if (form === "single-file") expect(requests).toEqual([]);
    else expect(requests.every(request => request.startsWith(origin))).toBe(true);
  });
}
