import { readerHint, readerLocation, readerMotion } from "../application/reader-navigation.ts";
import type { Catalog } from "../content/catalog.ts";
import type { Command, FieldState } from "../core/types.ts";
import type { OverviewRegion } from "../geometry/overview.ts";

/** Stable DOM controls use the same command port as the geometric labels. */
export class ReaderNavigation {
  readonly element: HTMLElement;
  private readonly location: HTMLElement;
  private readonly title: HTMLElement;
  private readonly count: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly local: HTMLElement;
  private readonly index: HTMLElement;
  private readonly map: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly hubs = new Map<string, HTMLButtonElement>();

  constructor(host: HTMLElement, settingsIcon: SVGSVGElement) {
    const root = document.createElement("section");
    root.id = "readerNavigation";
    root.setAttribute("aria-label", "阅读导航");
    root.innerHTML = `
      <header class="reader-heading">
        <div class="reader-identity"><span class="reader-brand">ANALLIA</span><span class="reader-location"></span></div>
        <h1 class="reader-title" aria-live="polite" aria-atomic="true"></h1>
      </header>
      <nav id="hudControls" class="hud-controls" aria-label="全局导航"></nav>
      <footer class="reader-footer">
        <section class="reader-map" hidden>
          <div class="reader-map-controls"></div>
          <nav id="readerMapIndex" class="reader-index" aria-label="内容地图"></nav>
        </section>
        <nav class="reader-local" aria-label="当前章节导航"><span class="reader-count"></span></nav>
        <p class="reader-hint"></p>
      </footer>`;
    this.element = root;
    this.location = root.querySelector(".reader-location")!;
    this.title = root.querySelector(".reader-title")!;
    this.count = root.querySelector(".reader-count")!;
    this.hint = root.querySelector(".reader-hint")!;
    this.local = root.querySelector(".reader-local")!;
    this.index = root.querySelector(".reader-index")!;
    this.map = root.querySelector(".reader-map")!;
    const global = root.querySelector<HTMLElement>("#hudControls")!;
    const add = (parent: HTMLElement, key: string, label: string, title: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hud-btn";
      button.dataset.command = `hud:${key}`;
      button.textContent = label;
      button.title = title;
      parent.append(button);
      this.buttons.set(key, button);
      return button;
    };
    add(global, "back", "返回", "返回上一处访问（Esc）；与上一层不同");
    add(global, "overview", "全域", "拉远查看所有枢（Home）");
    add(global, "refocus", "继续阅读", "回到当前枢和章节");
    add(global, "search", "搜索", "搜索篇章");
    add(global, "settings", "设置", "主题、声音与动效").prepend(settingsIcon);
    const sound = add(global, "sound", "声音", "切换声音");
    sound.setAttribute("aria-label", "声音");
    add(this.local, "previous", "← 上一节", "同层的上一节（←）");
    add(this.local, "next", "下一节 →", "同层的下一节（→）");
    add(this.local, "up", "上一层", "前往父章节");
    add(this.local, "enter", "进入下一层", "进入当前章节的第一篇子章节");
    add(this.local, "morph", "展开为线", "改变几何形态，保持当前章节");
    const mapControls = root.querySelector<HTMLElement>(".reader-map-controls")!;
    add(mapControls, "map-toggle", "收起目录", "开合内容目录并适配地图取景").setAttribute("aria-controls", "readerMapIndex");
    add(mapControls, "map-fit", "重新取景", "将所有枢重新放入可见地图区域");
    host.prepend(root);
    // Controls are not a world-space drag/wheel surface, including on touch devices.
    for (const event of ["pointerdown", "wheel"]) {
      root.addEventListener(event, e => e.stopPropagation());
    }
  }

  /** Read after render so fonts, safe areas and panel height are accounted for. */
  get overviewRegion(): OverviewRegion | null {
    if (this.element.dataset.location !== "overview") return null;
    const bounds = this.element.getBoundingClientRect();
    const controls = this.element.querySelector("#hudControls")!.getBoundingClientRect();
    const footer = this.element.querySelector(".reader-footer")!.getBoundingClientRect();
    const map = this.map.getBoundingClientRect();
    const heading = this.element.querySelector(".reader-heading")!.getBoundingClientRect();
    const top = Math.max(controls.bottom, heading.bottom) + 16;
    const left = map.top < footer.top - 1 ? map.right + 24 : 24;
    return { left, top, width: Math.max(1, bounds.width - left - 24), height: Math.max(1, footer.top - top - 16) };
  }

  render(state: FieldState, catalog: Catalog, actions: Map<string, Command>): void {
    const location = readerLocation(state, catalog);
    const motion = readerMotion(state);
    this.element.dataset.location = location.kind;
    this.element.dataset.motion = motion.kind;
    this.element.dataset.mapPanel = state.overviewPanel;
    const text = (element: HTMLElement, value: string) => {
      if (element.textContent !== value) element.textContent = value;
    };
    const command = (key: string, value: Command, enabled = true, visible = true) => {
      const button = this.buttons.get(key)!;
      button.disabled = !enabled;
      button.hidden = !visible;
      if (enabled && visible) actions.set(`hud:${key}`, value);
    };
    const ready = location.kind !== "loading";
    command("back", { type: "back" }, ready && state.history.length > 0);
    command("overview", { type: "overview" }, ready && location.kind !== "overview");
    command("refocus", { type: "focus", hub: state.focus }, ready, location.kind === "overview");
    command("search", { type: "navigate", target: catalog.searchRoot ?? "" }, ready, !!catalog.searchRoot);
    command("settings", { type: "navigate", target: catalog.settingsRoot ?? "" }, ready, !!catalog.settingsRoot);
    command("sound", { type: "navigate", target: "act:toggle_sound" }, ready);
    this.buttons.get("sound")!.setAttribute("aria-pressed", String(state.settings.sound !== false));
    this.buttons.get("overview")!.setAttribute("aria-pressed", String(location.kind === "overview"));
    text(this.hint, readerHint(location, motion));
    this.local.hidden = location.kind !== "reading";
    this.map.hidden = location.kind !== "overview";
    this.index.hidden = state.viewport.width <= 700 && state.overviewPanel === "collapsed";
    command("map-toggle", { type: "toggle-overview-map" }, ready, location.kind === "overview" && state.viewport.width <= 700);
    command("map-fit", { type: "overview" }, ready, location.kind === "overview" && state.viewport.width <= 700);
    const mapToggle = this.buttons.get("map-toggle")!;
    mapToggle.setAttribute("aria-expanded", String(!this.index.hidden));
    text(mapToggle, this.index.hidden ? "展开目录" : "收起目录");
    if (location.kind === "overview") {
      for (const destination of location.destinations) {
        let button = this.hubs.get(destination.hub);
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "hud-btn";
          button.dataset.command = `hud:hub:${destination.hub}`;
          this.hubs.set(destination.hub, button);
          this.index.append(button);
        }
        text(button, `${destination.glyph}  ${destination.title}`);
        button.setAttribute("aria-current", String(destination.hub === location.hub));
        actions.set(`hud:hub:${destination.hub}`, { type: "focus", hub: destination.hub });
      }
    }
    if (location.kind === "reading") {
      text(this.location, location.trail);
      text(this.title, location.title);
      text(this.count, `${location.anchor} · ${location.parent ? `同层 ${location.position + 1} / ${location.total}` : "起点"}`);
      this.count.setAttribute("aria-label", `当前锚点 ${location.anchor}，同层第 ${location.position + 1} 节，共 ${location.total} 节`);
      const searchStart = location.chapter === catalog.searchRoot;
      text(this.buttons.get("next")!, searchStart ? "查看结果 →" : "下一节 →");
      this.buttons.get("next")!.title = searchStart ? "打开首个检索结果（→）" : "同层的下一节（→）";
      if (searchStart) {
        const count = Math.max(0, location.total - 1);
        text(this.count, `${location.anchor} · ${count} 项结果`);
        this.count.setAttribute("aria-label", `当前锚点 ${location.anchor}，${count} 项检索结果`);
        if (motion.kind === "idle") text(this.hint, count
          ? "点击「查看结果」，或沿当前枢检视周界标签"
          : "没有匹配结果 · 试试其他关键词");
      }
      command("previous", { type: "step", delta: -1 }, location.position > 0, location.total > 1);
      command("next", { type: "step", delta: 1 }, location.position < location.total - 1, location.total > 1);
      command("up", { type: "up" }, !!location.parent, !!location.parent);
      command("enter", { type: "navigate", target: location.child ?? location.chapter }, !!location.child, !!location.child);
      command("morph", { type: "morph" });
      text(this.buttons.get("morph")!, location.shape === "circle" ? "展开为线" : "收拢为圆");
    } else {
      text(this.location, location.kind === "overview" ? "全域 · 内容地图" : "正在准备");
      text(this.title, location.kind === "overview" ? `继续阅读：${location.title}` : "让篇章进入视野");
    }
  }

  destroy(): void { this.element.remove(); }
}
