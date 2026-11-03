import type { Page } from "@playwright/test";
// Static-edition tests need final body geometry, not only the first readable chunk.
export async function settled(page: Page, chapter?: string) {
  await page.waitForFunction((chapter) => {
    const a = (window as any).__shuyra,
      s = a?.handle.getState();
    const article =
      s?.status === "active"
        ? document.getElementById(`text-${s.location.chapter}`)
        : null;
    return (
      s?.status === "active" &&
      s.view === "reading" &&
      s.motion === "idle" &&
      s.readable &&
      s.content === "complete" &&
      s.request === null &&
      a.reading.activeTask === null &&
      article &&
      !article.hidden &&
      article.dataset.presentation === s.location.presentation &&
      !a.field.isAnimating &&
      !a.scene.isAnimating &&
      JSON.stringify(a.field.state.camera) ===
        JSON.stringify(a.scene.frame.camera) &&
      (!chapter || s.location.chapter === chapter)
    );
  }, chapter);
}
export async function activate(page: Page, id: string, touch = false) {
  const point = await page.evaluate((id) => {
    const label = (window as any).__shuyra.scene.frame.labels.find(
      (x: any) => x.id === id,
    );
    if (!label) throw Error(`Missing hub label ${id}`);
    return label.layout.position;
  }, id);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}
export async function chapter(
  page: Page,
  target: string,
  _operation: string,
  touch = false,
) {
  // A search input can update semantic results before the next numeric frame.
  // Target the concrete, interactive chapter identity after that frame arrives.
  await page.waitForFunction(target => (window as any).__shuyra.scene.frame.labels.some(
    (label: any) => label.interactive && label.opacity > .98 &&
      label.command.type === "navigate" && label.command.target === target), target);
  const id = await page.evaluate(target => (window as any).__shuyra.scene.frame.labels.find(
    (label: any) => label.interactive && label.command.type === "navigate" &&
      label.command.target === target).id, target);
  await activate(page, id, touch);
  await settled(page, target);
}
export async function place(page: Page, hub: string, target: string, touch = false) {
  await page.locator('[data-command="hud:overview"]').click();
  await page.waitForFunction(() => { const a = (window as any).__shuyra;
    return a.field.state.overview && !a.field.isAnimating && !a.scene.isAnimating &&
      JSON.stringify(a.field.state.camera) === JSON.stringify(a.scene.frame.camera); });
  const at = await page.evaluate(hub => {
    const a = (window as any).__shuyra, id = `hub:${hub}`;
    const shape = a.scene.frame.hitRegions.find((h: any) => h.id === id).shape;
    const points = shape.type === "circle" ? Array.from({ length: 96 }, (_, i) => ({
      x: shape.x + shape.radius * Math.cos(i * Math.PI / 48),
      y: shape.y + shape.radius * Math.sin(i * Math.PI / 48) })) : shape.points;
    const at = points.find((p: any) => p.x > 10 && p.x < innerWidth - 10 &&
      p.y > 124 && p.y < innerHeight - 10 && a.scene.hitTest(p)?.id === id);
    if (!at) throw Error(`No visible curve target for ${hub}`);
    return at;
  }, hub);
  if (touch) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y);
  await settled(page, target);
}
export async function morph(page: Page, chapterId: string) {
  const id = await page.evaluate(
    () =>
      (window as any).__shuyra.scene.frame.labels.find(
        (x: any) => x.visual === "current" && !x.id.includes("tide:"),
      ).id,
  );
  await activate(page, id);
  await settled(page, chapterId);
}
