import type { Field } from "../application/field.ts";
import { worldToScreen } from "../geometry/field.ts";
import { leavesIxPages } from "./leaves-ix-content.ts";
export { createLeavesIxDemo } from "./leaves-ix-content.ts";
import "./leaves-ix.css";

export function mountLeavesIx(
  host: HTMLElement,
  field: Field,
  signal: AbortSignal,
) {
  const document = host.ownerDocument;
  document.documentElement.dataset.demo = "leaves-ix";
  const previousTitle = document.title;
  document.title = "叶之屋 · IX / 迷宫 — Anallia 排版习作";
  const layer = document.createElement("section");
  layer.id = "leavesIx";
  layer.setAttribute("aria-label", "叶之屋第九章排版习作导航");
  layer.innerHTML = `
    <header class="ix-heading"><div class="ix-kicker">ANALLIA / TYPOGRAPHIC STUDY 01</div>
      <h1>叶之<span>屋</span><i>IX</i></h1><p>迷宫从页边开始。</p>
      <small>第九章排版启发 · 原创示例文字</small></header>
    <aside class="ix-marginalia" aria-label="边注"><span class="ix-note-number">[ 01 ]</span>
      <p>这里的注释并不解释正文。<br>它只是打开另一扇门。</p>
      <button type="button" data-ix-target="ix-note">沿注释离开 ↗</button>
      <p class="ix-erasure"><s>这里没有别的房间。</s></p>
      <small>也许，房间在另一页。</small></aside>
    <button type="button" class="ix-empty-room" aria-label="穿过蓝色空窗，进入空室" data-ix-target="ix-void">
      <span class="ix-room-label">INTERIOR / ∅</span><span class="ix-room-inner"></span>
      <span class="ix-room-mirror" aria-hidden="true">此处并无陈设</span></button>
    <nav class="ix-footer" aria-label="迷宫阅读路径"><div class="ix-route">
      ${leavesIxPages.map((page) => `<button type="button" data-ix-target="${page.id}">${page.label}</button>`).join("")}</div>
      <div class="ix-footer-line"><span class="ix-location" aria-live="polite"></span>
      <div class="ix-directions"><button type="button" data-ix-back>↶ 原路返回</button><button type="button" data-ix-next>沿正文 →</button><button type="button" data-ix-rotate>转动纸面 ↻</button><a class="ix-exit">离开习作 ↗</a></div></div>
    </nav>`;
  const exit = layer.querySelector<HTMLAnchorElement>(".ix-exit")!;
  exit.href = document.location.pathname;
  layer.addEventListener("pointerdown", (event) => event.stopPropagation(), {
    signal,
  });
  layer.addEventListener("wheel", (event) => event.stopPropagation(), {
    signal,
  });
  layer.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "button",
      );
      if (!button) return;
      if (button.hasAttribute("data-ix-rotate")) {
        field.rotate(18);
        return;
      }
      if (button.hasAttribute("data-ix-back")) field.dispatch({ type: "back" });
      else {
        const current = leavesIxPages.find(
          (page) => page.id === field.selected().id,
        );
        const target = button.dataset.ixTarget ?? current?.next ?? "ix-entry";
        field.dispatch({ type: "navigate", target });
      }
    },
    { signal },
  );
  host.append(layer);
  const room = layer.querySelector<HTMLElement>(".ix-empty-room")!;
  const location = layer.querySelector<HTMLElement>(".ix-location")!;
  const back = layer.querySelector<HTMLButtonElement>("[data-ix-back]")!;
  const next = layer.querySelector<HTMLButtonElement>("[data-ix-next]")!;
  const rotate = layer.querySelector<HTMLButtonElement>("[data-ix-rotate]")!;
  const seen = new Set<string>();
  let lastChapter = "";
  signal.addEventListener(
    "abort",
    () => {
      layer.remove();
      delete host.dataset.readingBottomInset;
      delete document.documentElement.dataset.demo;
      document.title = previousTitle;
    },
    { once: true },
  );
  return {
    update() {
      host.dataset.readingBottomInset =
        field.state.viewport.width < 600 ? "140" : "108";
      const id = field.selected().id;
      if (lastChapter !== id) {
        seen.add(id);
        const page = leavesIxPages.find((item) => item.id === id);
        location.textContent = page
          ? `IX / ${page.label} · ${seen.size} 个位置留下脚印`
          : "IX / 页外";
        next.textContent = page?.id.startsWith("ix-note")
          ? "沿注释 →"
          : "沿正文 →";
        for (const link of layer.querySelectorAll<HTMLElement>(
          "[data-ix-target]",
        )) {
          const active = link.dataset.ixTarget === id;
          if (active) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
          link.dataset.visited = String(seen.has(link.dataset.ixTarget!));
        }
        lastChapter = id;
      }
      back.disabled = field.state.history.length === 0;
      rotate.disabled =
        field.state.loading ||
        !!field.state.passage ||
        !!field.state.morphTurn ||
        !!field.state.contentTurn;
      const hub = field.hub;
      room.hidden =
        hub.morph > 0.15 ||
        field.state.overview ||
        !hub.id.startsWith("IX") ||
        field.state.loading;
      if (!room.hidden) {
        const center = worldToScreen(
          hub.center,
          field.state.camera,
          field.state.viewport,
        );
        room.style.transform = `translate(${center.x}px,${center.y}px) translate(-50%,-50%) scale(${Math.min(1.1, field.state.camera.z)})`;
      }
    },
  };
}
