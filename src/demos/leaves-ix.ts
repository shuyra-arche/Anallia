import type { Field } from "../application/field.ts";
import { worldToScreen } from "../geometry/field.ts";
import { leavesIxPages } from "./leaves-ix-content.ts";
export { createLeavesIxDemo } from "./leaves-ix-content.ts";
import "./leaves-ix.css";

const MARGINALIA_NOTES: Record<
  string,
  { badge: string; body: string; cta: string; target: string; sub: string }
> = {
  "ix-entry": {
    badge: "[ 01 ]",
    body: "这里的注释并不解释正文。<br>它只是打开另一扇门。",
    cta: "沿注释离开 ↗",
    target: "ix-note",
    sub: "文本行径向指向圆心，随滚轮浮动转入焦点；围绕圆周展开，重合处如歌词消隐显现。",
  },
  "ix-turn": {
    badge: "[ 02 ]",
    body: "通道 A 与通道 B 的笔画完全相同。<br>右侧的清单记录了房间缺失之物。",
    cta: "翻向注释 02 ↗",
    target: "ix-note-two",
    sub: "径向排布围绕整个圆周，摄像机静止，滚动时文本顺滑转到下一行。",
  },
  "ix-echo": {
    badge: "[ 01 · 回声 ]",
    body: "第二个声音并没有晚到；<br>是第一个声音尚未离开。",
    cta: "重读注释 01 ↗",
    target: "ix-note",
    sub: "空白处或首尾滚轮可切换相邻位置。",
  },
  "ix-exit": {
    badge: "[ 03 · 折返 ]",
    body: "把沿途的注释折回原位，<br>它们拼成了另一间屋子的平面。",
    cta: "进入空室 ↗",
    target: "ix-void",
    sub: "推开门槛，这一页便再次成为入口。",
  },
  "ix-note": {
    badge: "[ n.01 · 旁注 ]",
    body: "原来写在页脚的文字慢慢占满了房间，<br>正文被挤到一旁成了旁注。",
    cta: "深入注释 02 ↗",
    target: "ix-note-two",
    sub: "下一段包含十七条连续长卷清单。",
  },
  "ix-note-two": {
    badge: "[ n.02 · 长卷清单 ]",
    body: "清单在绕完一圈之后，<br>将下一句交给了下一行。",
    cta: "穿过蓝色空室 ↗",
    target: "ix-void",
    sub: "长卷清单围绕圆周展开，重合行如歌词消隐显现；滚轮至首尾可平滑切章。",
  },
  "ix-void": {
    badge: "[ ∅ · 走廊线枢 ]",
    body: "只剩一条斜向延伸的界线，<br>以及几行拒绝跟着它倾斜的文字。",
    cta: "返回门槛 ↙",
    target: "ix-entry",
    sub: "点击「转动纸面 ↻」观察 360° 水平贴合。",
  },
};

export function mountLeavesIx(
  host: HTMLElement,
  field: Field,
  signal: AbortSignal,
  onExit?: () => void,
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
      <p class="ix-marginalia-body">这里的注释并不解释正文。<br>它只是打开另一扇门。</p>
      <button type="button" class="ix-marginalia-cta" data-ix-target="ix-note">沿注释离开 ↗</button>
      <div class="ix-progress-pill" aria-live="polite"></div>
      <p class="ix-erasure"><s>这里没有别的房间。</s></p>
      <small class="ix-marginalia-sub">也许，房间在另一页。</small></aside>
    <button type="button" class="ix-empty-room" aria-label="穿过蓝色空窗，进入空室" data-ix-target="ix-void">
      <span class="ix-room-label">INTERIOR / ∅</span><span class="ix-room-inner"></span>
      <span class="ix-room-mirror" aria-hidden="true">此处并无陈设</span></button>
    <nav class="ix-footer" aria-label="迷宫阅读路径"><div class="ix-route">
      ${leavesIxPages.map((page) => `<button type="button" data-ix-target="${page.id}">${page.label}</button>`).join("")}</div>
      <div class="ix-footer-line"><span class="ix-location" aria-live="polite"></span>
      <div class="ix-directions"><button type="button" data-ix-back>↶ 原路返回</button><button type="button" data-ix-next>沿正文 →</button><button type="button" data-ix-circle-mode>切换周界环绕 ◎</button><button type="button" data-ix-morph>展开为线 ╱</button><button type="button" data-ix-rotate>转动纸面 ↻</button><a class="ix-exit">离开习作 ↗</a></div></div>
    </nav>`;
  const exit = layer.querySelector<HTMLAnchorElement>(".ix-exit")!;
  exit.href = document.location.pathname || "/";
  layer.addEventListener("pointerdown", (event) => event.stopPropagation(), {
    signal,
  });
  layer.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      const exitLink = (event.target as Element).closest<HTMLAnchorElement>(
        "a.ix-exit",
      );
      if (exitLink && onExit) {
        event.preventDefault();
        onExit();
        return;
      }
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "button",
      );
      if (!button) return;
      if (button.hasAttribute("data-ix-rotate")) {
        field.rotate(18);
        return;
      }
      if (button.hasAttribute("data-ix-circle-mode")) {
        const docEl = document.documentElement;
        const nextRing = docEl.dataset.circleReadingMode !== "ring";
        if (nextRing) {
          docEl.dataset.circleReadingMode = "ring";
        } else {
          delete docEl.dataset.circleReadingMode;
          field.clearReadingRows();
        }
        field.hub.textOffset = field.hub.textOffsetTarget = 0;
        return;
      }
      if (button.hasAttribute("data-ix-morph")) {
        field.dispatch({ type: "morph" });
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
  const circleModeBtn = layer.querySelector<HTMLButtonElement>("[data-ix-circle-mode]")!;
  const morphBtn = layer.querySelector<HTMLButtonElement>("[data-ix-morph]")!;
  const rotate = layer.querySelector<HTMLButtonElement>("[data-ix-rotate]")!;
  const noteNum = layer.querySelector<HTMLElement>(".ix-note-number")!;
  const noteBody = layer.querySelector<HTMLElement>(".ix-marginalia-body")!;
  const noteCta = layer.querySelector<HTMLButtonElement>(".ix-marginalia-cta")!;
  const noteSub = layer.querySelector<HTMLElement>(".ix-marginalia-sub")!;
  const progressPill = layer.querySelector<HTMLElement>(".ix-progress-pill")!;
  const seen = new Set<string>();
  let lastChapter = "";
  signal.addEventListener(
    "abort",
    () => {
      layer.remove();
      delete host.dataset.readingBottomInset;
      delete document.documentElement.dataset.demo;
      delete document.documentElement.dataset.circleReadingMode;
      document.title = previousTitle;
    },
    { once: true },
  );
  return {
    update() {
      host.dataset.readingBottomInset =
        field.state.viewport.width < 600 ? "140" : "108";
      const id = field.selected().id;
      const hub = field.hub;
      const isRingMode = document.documentElement.dataset.circleReadingMode === "ring";
      if (lastChapter !== id) {
        seen.add(id);
        const page = leavesIxPages.find((item) => item.id === id);
        location.textContent = page
          ? `IX / ${page.label} · ${seen.size} 个位置留下脚印`
          : "IX / 页外";
        next.textContent = page?.id.startsWith("ix-note")
          ? "沿注释 →"
          : "沿正文 →";
        const meta = MARGINALIA_NOTES[id] ?? MARGINALIA_NOTES["ix-entry"];
        noteNum.textContent = meta.badge;
        noteBody.innerHTML = meta.body;
        noteCta.textContent = meta.cta;
        noteCta.dataset.ixTarget = meta.target;
        noteSub.textContent = meta.sub;
        for (const link of layer.querySelectorAll<HTMLElement>(
          ".ix-route [data-ix-target]",
        )) {
          const active = link.dataset.ixTarget === id;
          if (active) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
          link.dataset.visited = String(seen.has(link.dataset.ixTarget!));
        }
        lastChapter = id;
      }
      const article = document.getElementById(`text-${id}`);
      const geoRoot = article?.querySelector<HTMLElement>(".geometric-content");
      const totalRows = Number(geoRoot?.dataset.readingRows ?? 0);
      const currentRow = Math.min(
        Math.max(1, totalRows),
        Math.round(Number(geoRoot?.dataset.readingProgress ?? 0)) + 1,
      );
      const postureLabel =
        hub.targetMorph > 0.5
          ? "走廊线枢"
          : isRingMode
            ? "圆环周界"
            : "径向歌词浮动";
      const nextPill =
        totalRows > 0
          ? `${postureLabel} · 第 ${currentRow} / ${totalRows} 行`
          : postureLabel;
      if (progressPill.textContent !== nextPill)
        progressPill.textContent = nextPill;

      const nextCircleModeLabel = isRingMode
        ? "切换歌词浮动 ≋"
        : "切换周界环绕 ◎";
      if (circleModeBtn.textContent !== nextCircleModeLabel)
        circleModeBtn.textContent = nextCircleModeLabel;
      circleModeBtn.hidden = hub.targetMorph > 0.5;

      const nextMorphLabel =
        hub.targetMorph > 0.5 ? "收拢为圆 ◯" : "展开为线 ╱";
      if (morphBtn.textContent !== nextMorphLabel)
        morphBtn.textContent = nextMorphLabel;

      back.disabled = field.state.history.length === 0;
      const busy =
        field.state.loading ||
        !!field.state.passage ||
        !!field.state.morphTurn ||
        !!field.state.contentTurn;
      rotate.disabled = busy;
      morphBtn.disabled = busy;
      circleModeBtn.disabled = busy;
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
        room.style.transform = `translate(${center.x.toFixed(1)}px,${center.y.toFixed(1)}px) translate(-50%,-50%) scale(${Math.min(1.06, field.state.camera.z * 0.92).toFixed(3)})`;
      }
    },
  };
}
