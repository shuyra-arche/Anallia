import { fillArticle } from "./article.ts";
import { frameRateFromAction } from "../core/frame-rate.ts";
import type { Command, FieldState, Hub, Settings, Vec } from "../core/types.ts";
import { rot, unit, ease, mix, clamp } from "../core/math.ts";
import { Catalog } from "../content/catalog.ts";
import {
  evaluateHubGeometry,
  material,
  outwardNormal,
  nodeS,
  arcOffsetS,
  worldToScreen,
} from "../geometry/field.ts";
import { svg, requireElement } from "./dom.ts";
interface Label {
  group: SVGGElement;
  stem: SVGPathElement;
  ring: SVGCircleElement;
  text: SVGTextElement;
  hit: SVGRectElement;
}
function isActionPressed(
  action: string,
  settings: Settings,
): boolean | undefined {
  const rate = frameRateFromAction(action);
  if (rate !== undefined) return rate === settings.frameRate;
  switch (action) {
    case "range06":
      return Math.abs(settings.range - 0.62) < 0.05;
    case "range12":
      return Math.abs(settings.range - 1.25) < 0.05;
    case "range32":
      return Math.abs(settings.range - 3.2) < 0.05;
    case "blur10":
      return Math.abs(settings.blur - 1) < 0.05;
    case "blur16":
      return Math.abs(settings.blur - 1.65) < 0.05;
    case "speed075":
      return Math.abs(settings.speed - 0.75) < 0.05;
    case "speed100":
      return Math.abs(settings.speed - 1) < 0.05;
    case "speed125":
      return Math.abs(settings.speed - 1.25) < 0.05;
    case "toggle_blur":
      return settings.blur > 0;
    case "toggle_range":
      return settings.range > 0.9;
    case "toggle_motion":
      return settings.reducedMotion;
    default:
      return undefined;
  }
}
export class Scene {
  private root: SVGSVGElement;
  private geometry: SVGGElement;
  private labels: SVGGElement;
  private reading: HTMLElement;
  private hubs = new Map<
    string,
    { path: SVGPathElement; hit: SVGPathElement; labels: Map<string, Label> }
  >();
  private articles = new Map<string, HTMLElement>();
  readonly actions = new Map<string, Command>();
  private lastRenderKey = "";
  private heights = new Map<string, number>();
  private measuredSettings = "";
  invalidateLayout() {
    this.heights.clear();
    this.lastRenderKey = "";
  }
  private host: HTMLElement;
  private catalog: Catalog;
  constructor(host: HTMLElement, catalog: Catalog) {
    this.host = host;
    this.catalog = catalog;
    this.root = requireElement(host, "#world");
    this.geometry = requireElement(host, "#gGeometry");
    this.labels = requireElement(host, "#gLabels");
    this.reading = requireElement(host, "#reading");
    for (const hub of catalog.definitions)
      this.hubs.set(hub.id, {
        path: svg("path", this.geometry, { class: "curve" }),
        hit: svg("path", this.geometry, {
          class: "hit",
          "data-command": `hub:${hub.id}`,
        }),
        labels: new Map(),
      });
    for (const node of catalog.chapters.values()) {
      const article = document.createElement("article");
      article.className = "note";
      article.id = `text-${node.id}`;
      article.hidden = true;
      this.reading.append(article);
      this.articles.set(node.id, article);
    }
  }
  private selected(hub: Hub) {
    return this.catalog.get(hub.path.at(-1)!);
  }
  private label(
    hub: Hub,
    key: string,
    name: string,
    at: Vec,
    anchor: Vec,
    kind: string,
    degree: number,
    command: Command,
    aria = name,
    alpha = 1,
  ) {
    const pool = this.hubs.get(hub.id)!.labels;
    let entry = pool.get(key);
    if (!entry) {
      const group = svg("g", this.labels, {
        class: "tag-group",
        tabindex: 0,
        role: "button",
      });
      entry = {
        group,
        stem: svg("path", group),
        ring: svg("circle", group, { class: "label-ring", r: 16 }),
        text: svg("text", group),
        hit: svg("rect", group, { class: "label-hit", height: 38, rx: 6 }),
      };
      pool.set(key, entry);
    }
    const e = entry,
      id = `${hub.id}:${key}`;
    this.actions.set(id, command);
    e.group.style.display = "";
    e.group.style.opacity = alpha < 0.999 ? String(alpha) : "";
    e.group.dataset.command = id;
    e.group.classList.toggle("is-current", kind === "current");
    e.group.setAttribute("aria-label", aria);
    e.stem.setAttribute("class", `stem${kind === "nav" ? " nav" : ""}`);
    e.stem.setAttribute("d", `M${anchor.x} ${anchor.y}L${at.x} ${at.y}`);
    e.ring.setAttribute("cx", String(at.x));
    e.ring.setAttribute("cy", String(at.y));
    e.text.setAttribute("class", `label ${kind}`);
    e.text.setAttribute("x", String(at.x));
    e.text.setAttribute("y", String(at.y));
    e.text.textContent = name;
    while (degree > 90) degree -= 180;
    while (degree < -90) degree += 180;
    e.text.setAttribute("transform", `rotate(${degree} ${at.x} ${at.y})`);
    const width = Math.max(38, name.length * 14 + 18);
    e.hit.setAttribute("x", String(at.x - width / 2));
    e.hit.setAttribute("y", String(at.y - 19));
    e.hit.setAttribute("width", String(width));
  }
  render(s: FieldState) {
    const key = JSON.stringify([
      s.camera,
      s.viewport,
      s.focus,
      s.overview,
      s.loading,
      s.theme,
      s.settings,
      s.description,
      s.searchQuery,
      s.searchResults,
      s.history.length,
      s.passage?.phase,
      Object.values(s.hubs).map((h) => [
        h.id,
        h.morph,
        h.fold,
        h.scroll,
        h.path,
      ]),
    ]);
    if (key === this.lastRenderKey) return;
    this.lastRenderKey = key;
    const settingsKey = JSON.stringify(s.settings);
    if (this.measuredSettings !== settingsKey) {
      this.heights.clear();
      this.measuredSettings = settingsKey;
    }
    this.root.setAttribute(
      "viewBox",
      `0 0 ${s.viewport.width} ${s.viewport.height}`,
    );
    this.actions.clear();
    for (const { labels } of this.hubs.values())
      for (const e of labels.values()) e.group.style.display = "none";
    const project = (p: Vec) => worldToScreen(p, s.camera, s.viewport);
    for (const h of Object.values(s.hubs)) {
      const entry = this.hubs.get(h.id)!,
        active = h.id === s.focus && !s.overview && !s.loading;
      const path = evaluateHubGeometry(h, s.camera, s.viewport).strokeD;
      entry.path.setAttribute("d", path);
      entry.hit.setAttribute("d", path);
      entry.path.setAttribute("class", `curve${active ? " selected" : ""}`);
      entry.path.style.opacity = s.loading
        ? "0.1"
        : s.overview
          ? "0.72"
          : active
            ? "1"
            : "0.42";

      this.actions.set(
        `hub:${h.id}`,
        active ? { type: "morph" } : { type: "focus", hub: h.id },
      );
      if (s.loading) continue;
      const current = this.selected(h),
        nodes = this.catalog.siblings(current.id, s.searchResults),
        focus = nodeS(h, h.scroll, nodes.length, s.camera, s.viewport);
      const label = (
        key: string,
        name: string,
        position: number,
        offset: number,
        kind: string,
        command: Command,
        aria?: string,
        alpha = 1,
      ) => {
        const a = project(material(h, position)),
          q = project(material(h, position, offset)),
          n = unit(
            rot(
              outwardNormal(h, position),
              (s.camera.rotation * Math.PI) / 180,
            ),
          );
        this.label(
          h,
          key,
          name,
          q,
          a,
          kind,
          (Math.atan2(n.y, n.x) * 180) / Math.PI,
          command,
          aria,
          alpha,
        );
      };
      if (!active) {
        label("background", current.name, focus, 30, "background", {
          type: "focus",
          hub: h.id,
        });
        continue;
      }
      const windowed = nodes.length > 6;
      nodes.forEach((n, i) => {
        const dist = Math.abs(i - h.scroll);
        if (windowed && dist > 3.6 && !(h.layout === "anchored" && i === 0))
          return;
        const alpha = windowed ? clamp((3.8 - dist) / 1.1, 0.25, 1) : 1;
        label(
          n.id,
          n.name,
          nodeS(h, i, nodes.length, s.camera, s.viewport),
          34,
          n.id === current.id ? "current" : "peer",
          n.id === current.id
            ? { type: "morph" }
            : { type: "navigate", target: n.id },
          `${n.name} · ${n.title}${n.id === current.id ? " · 切换圆线形态" : ""}`,
          alpha,
        );
      });
      const nav: { glyph: string; aria: string; command: Command }[] = [];
      if (current.parent)
        nav.push({ glyph: "↑", aria: "返回上一级", command: { type: "up" } });
      if (s.history.length)
        nav.push({
          glyph: "↶",
          aria: "返回上一状态",
          command: { type: "back" },
        });
      nav.push({ glyph: "⊙", aria: "全域观察", command: { type: "overview" } });
      const search = this.catalog.definitions.find(
        (def) => def.kind === "search",
      );
      if (search && h.id !== search.id)
        nav.push({
          glyph: "⌕",
          aria: "检索枢",
          command: { type: "navigate", target: search.root },
        });
      const settings = this.catalog.definitions.find(
        (def) => def.glyph === "⚙",
      );
      if (settings && h.id !== settings.id)
        nav.push({
          glyph: "⚙",
          aria: "设置",
          command: { type: "navigate", target: settings.root },
        });
      nav.push({
        glyph: "◌",
        aria: "播放 Loading V24 动效",
        command: { type: "loading" },
      });
      current.refs.forEach((ref) =>
        nav.push({
          glyph: ref.glyph,
          aria: `前往 ${ref.glyph}`,
          command: { type: "navigate", target: ref.target },
        }),
      );
      const navArcStep = s.viewport.width < 700 ? 44 : 50;
      nav.forEach((item, i) =>
        label(
          `nav:${i}`,
          item.glyph,
          arcOffsetS(h, focus, (i - (nav.length - 1) / 2) * navArcStep),
          -38,
          "nav",
          item.command,
          item.aria,
        ),
      );
    }
    this.renderTexts(s);
    const palettes = { light: "#f7f8f5", dark: "#101d22", obsidian: "#0c0e10" };
    this.host.ownerDocument.documentElement.dataset.theme = s.theme;
    requireElement(this.host, "#baseBg").setAttribute(
      "fill",
      palettes[s.theme],
    );
    const portal = requireElement(this.host, "#portalViewport"),
      stroke = requireElement<SVGPathElement>(this.host, "#portalStroke");
    if (s.passage) {
      const t = s.passage,
        h = s.hubs[t.phase < 0.5 ? t.source : t.target],
        geometry = evaluateHubGeometry(h, s.camera, s.viewport);
      portal.setAttribute("visibility", "visible");
      requireElement(this.host, "#portalBoundaryPath").setAttribute(
        "d",
        geometry.sweptClipD,
      );
      requireElement(this.host, "#portalBg").setAttribute(
        "fill",
        t.theme === s.theme
          ? s.theme === "light"
            ? "#e4eee8"
            : "#1a313a"
          : palettes[t.theme],
      );
      stroke.setAttribute("d", geometry.strokeD);
      stroke.setAttribute(
        "stroke",
        t.theme === "light" ? "#44796f" : "#9cc4e5",
      );
      stroke.style.opacity = String(Math.sin(t.phase * Math.PI) * 0.8);
    } else {
      portal.setAttribute("visibility", "hidden");
      stroke.style.opacity = "0";
    }
    requireElement<HTMLElement>(this.host, "#descBar").textContent =
      s.description;
  }
  private renderTexts(s: FieldState) {
    const hub = s.hubs[s.focus],
      nodes = this.catalog.siblings(this.selected(hub).id, s.searchResults),
      small = s.viewport.width < 700,
      morph = ease(clamp(hub.morph, 0, 1));
    const p = s.passage?.phase,
      fold =
        p === undefined
          ? 1
          : p < 0.5
            ? 1 - ease(p / 0.44)
            : ease((p - 0.52) / 0.48);
    const visible = new Set<string>();
    if (!s.overview && !s.loading)
      nodes.forEach((node, i) => {
        const surface =
          ease(clamp(1 - Math.abs(i - hub.scroll) / s.settings.range, 0, 1)) *
          fold;
        if (surface < 0.015) return;
        const article = this.articles.get(node.id)!,
          depth = 1 - surface,
          presentation = morph > 0.5 ? "line" : "circle";
        if (article.dataset.presentation !== presentation)
          fillArticle(
            article,
            node,
            hub,
            presentation,
            this.catalog.searchRoot,
          );
        if (node.id === this.catalog.searchRoot) {
          const input = article.querySelector<HTMLInputElement>(
            "input.hub-search-input",
          );
          if (
            input &&
            this.host.ownerDocument.activeElement !== input &&
            input.value !== s.searchQuery
          ) {
            input.value = s.searchQuery;
          }
          const status = article.querySelector<HTMLElement>(".search-status");
          if (status) {
            const count = Math.max(0, nodes.length - 1);
            const nextText = s.searchQuery.trim()
              ? `已实时生成 ${count} 个周界标签 · 在空白处滚动或点击圆周标签检视`
              : `已挂载 ${count} 个推荐周界标签 · 输入时焦点恒定不中断`;
            if (status.textContent !== nextText) status.textContent = nextText;
          }
        }
        for (const button of article.querySelectorAll<HTMLButtonElement>(
          'button[data-target^="act:"]',
        )) {
          const pressed = isActionPressed(
            button.dataset.target!.slice(4),
            s.settings,
          );
          if (pressed === undefined) continue;
          const selected = String(pressed);
          if (button.getAttribute("aria-pressed") !== selected)
            button.setAttribute("aria-pressed", selected);
        }
        visible.add(node.id);
        if (article.hidden) article.hidden = false;
        const inert = !!s.passage || surface < 0.55;
        if (Boolean(article.inert) !== inert) article.inert = inert;
        const ariaHidden = String(inert);
        if (article.getAttribute("aria-hidden") !== ariaHidden)
          article.setAttribute("aria-hidden", ariaHidden);
        const position = nodeS(hub, i, nodes.length, s.camera, s.viewport),
          distance =
            mix(small ? 96 : 86, small ? 118 : 104, morph) - 26 * depth;
        const point = worldToScreen(
            material(hub, position, distance),
            s.camera,
            s.viewport,
          ),
          n = unit(
            rot(
              outwardNormal(hub, position),
              (s.camera.rotation * Math.PI) / 180,
            ),
          );
        const isLong = article.classList.contains("is-long");
        const widthPx = small
          ? Math.min(305, Math.max(200, s.viewport.width * 0.74))
          : isLong
            ? Math.min(435, Math.max(305, s.viewport.width * 0.34))
            : Math.min(355, Math.max(265, s.viewport.width * 0.29));
        const widthStr = `${widthPx}px`;
        if (article.style.width !== widthStr) article.style.width = widthStr;
        const heightKey = JSON.stringify([
          node.id,
          presentation,
          widthStr,
          node.id === this.catalog.searchRoot && !!s.searchQuery.trim(),
        ]);
        let height = this.heights.get(heightKey);
        if (height === undefined) {
          height = article.offsetHeight || 160;
          this.heights.set(heightKey, height);
        }
        const anchorY = isLong ? Math.min(height / 2, 130) : height / 2;
        const originStr = isLong ? `0 ${anchorY}px` : "0 50%";
        if (article.style.transformOrigin !== originStr)
          article.style.transformOrigin = originStr;
        const y = point.y - anchorY + 44 * depth,
          angle = (Math.atan2(n.y, n.x) * 180) / Math.PI;
        const transformStr = `translate3d(${point.x}px,${y}px,0) rotate(${angle}deg) scale(${0.72 + 0.28 * surface})`;
        if (article.style.transform !== transformStr)
          article.style.transform = transformStr;
        const blur = 8.5 * depth ** 1.12 * s.settings.blur;
        const filterStr =
          s.settings.reducedMotion || blur < 0.08 ? "none" : `blur(${blur}px)`;
        if (article.style.filter !== filterStr)
          article.style.filter = filterStr;
        const opacityStr = String(surface ** 1.2);
        if (article.style.opacity !== opacityStr)
          article.style.opacity = opacityStr;
        const pointerStr = inert ? "none" : "auto";
        if (article.style.pointerEvents !== pointerStr)
          article.style.pointerEvents = pointerStr;
      });
    for (const [id, article] of this.articles)
      if (!visible.has(id)) {
        if (!article.hidden) article.hidden = true;
        if (!article.inert) article.inert = true;
        if (article.getAttribute("aria-hidden") !== "true")
          article.setAttribute("aria-hidden", "true");
      }
  }
  destroy() {
    this.geometry.replaceChildren();
    this.labels.replaceChildren();
    this.reading.replaceChildren();
    this.actions.clear();
  }
}
