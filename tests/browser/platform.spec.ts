import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("LAN address serves modules and HMR updates without a fixed HMR host", async ({ page }) => {
  const address = Object.values(networkInterfaces()).flat().find(entry => entry && entry.family === "IPv4" && !entry.internal)?.address;
  test.skip(!address, "No LAN interface is available on this host");
  const directory = await mkdtemp(join(process.cwd(), "dev", "lan-probe-"));
  const file = join(directory, "probe.ts");
  const relative = directory.slice(process.cwd().length).replaceAll("\\", "/");
  const url = `http://${address}:5180`;
  const sockets: string[] = [];
  page.on("websocket", socket => sockets.push(socket.url()));
  try {
    await writeFile(file, "export default 'first'\n");
    await writeFile(join(directory, "index.html"), `<script type="module">import value from './probe.ts'; window.__lanProbe=value; if(import.meta.hot) import.meta.hot.accept('./probe.ts', module => { window.__lanProbe=module.default; });</script>`);
    await page.goto(`${url}${relative}/index.html`);
    await page.waitForFunction(() => (window as any).__lanProbe === "first");
    await expect.poll(() => sockets.some(socket => socket.startsWith(`ws://${address}:5180`))).toBe(true);
    await writeFile(file, "export default 'updated'\n");
    await page.waitForFunction(() => (window as any).__lanProbe === "updated");
    const response = await page.request.get(`${url}/src/main.ts`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("ContentStore");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("development loading geometry stays separate from the formal page", async ({ page }) => {
  await page.goto("/dev/loading.html");
  await page.locator("#startPreview").click();
  await expect(page.locator("#loadingOverlay")).toHaveClass("active");
  await expect.poll(() => page.locator("#circle0").getAttribute("d")).toMatch(/^M/);
  await page.locator("#exitPreview").click();
  await expect(page.locator("#loadingOverlay")).not.toHaveClass("active");
});

test("mobile touch activates DOM navigation and two-finger zoom", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await page.goto("/?renderer=svg");
    await page.waitForFunction(() => Boolean((window as any).__shuyra));
    await page.evaluate(() => (window as any).__shuyra.ready);
    await page.locator('#text-a0 [data-target="a1"]').first().tap();
    await page.waitForFunction(() => (window as any).__shuyra.field.selected().id === "a1" && !(window as any).__shuyra.field.isAnimating);
    const before = await page.evaluate(() => (window as any).__shuyra.field.state.camera.z);
    const input = await context.newCDPSession(page);
    await input.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 35, y: 45, id: 1 }, { x: 115, y: 45, id: 2 }] });
    await input.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 15, y: 45, id: 1 }, { x: 135, y: 45, id: 2 }] });
    await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => (window as any).__shuyra.field.state.camera.z)).toBeGreaterThan(before * 1.1);
  } finally { await context.close(); }
});
