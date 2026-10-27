import { frameRateFromAction } from "../core/frame-rate.ts";
import type { Chapter, Command, FieldState, Hub, Vec } from "../core/types.ts";
import { rot, unit, ease, mix, clamp } from "../core/math.ts";
import { Catalog } from "../content/catalog.ts";
import {
  evaluateHubGeometry,
  material,
  outwardNormal,
  nodeS,
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
  private measuredFrameRate: FieldState["settings"]["frameRate"] | undefined;
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
    if (this.measuredFrameRate !== s.settings.frameRate) {
      this.heights.clear();
      this.measuredFrameRate = s.settings.frameRate;
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
        nodes = this.catalog.siblings(current.id),
        focus = nodeS(h, h.scroll, nodes.length, s.camera, s.viewport);
      const label = (
        key: string,
        name: string,
        position: number,
        offset: number,
        kind: string,
        command: Command,
        aria?: string,
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
        );
      };
      if (!active) {
        label("background", current.name, focus, 30, "background", {
          type: "focus",
          hub: h.id,
        });
        continue;
      }
      nodes.forEach((n, i) =>
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
        ),
      );
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
      nav.forEach((item, i) =>
        label(
          `nav:${i}`,
          item.glyph,
          focus +
            (i - (nav.length - 1) / 2) * (s.viewport.width < 700 ? 48 : 56),
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
  private fillArticle(
    article: HTMLElement,
    node: Chapter,
    hub: Hub,
    presentation: "circle" | "line",
  ) {
    article.replaceChildren();
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = `${hub.glyph} / ${node.name} · DEPTH ${String(hub.path.length - 1).padStart(2, "0")}`;
    const heading = document.createElement("h2");
    heading.textContent = node.title;
    const paragraph = document.createElement("p"),
      source = node.expressions[presentation];
    let cursor = 0;
    for (const match of source.matchAll(/\{([^{}|]+)\|([^{}]+)\}/g)) {
      paragraph.append(
        document.createTextNode(source.slice(cursor, match.index)),
      );
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inline-ref";
      button.dataset.target = match[2];
      button.textContent = `${match[1]} ↗`;
      paragraph.append(button);
      cursor = match.index! + match[0].length;
    }
    paragraph.append(document.createTextNode(source.slice(cursor)));
    const tail = document.createElement("div");
    tail.className = "tail";
    tail.textContent = `${node.name} · ${presentation === "circle" ? "RADIAL TO CENTER" : "LINEAR SPINE"}`;
    article.append(eyebrow, heading, paragraph, tail);
    article.dataset.presentation = presentation;
  }
  private renderTexts(s: FieldState) {
    const hub = s.hubs[s.focus],
      nodes = this.catalog.siblings(this.selected(hub).id),
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
          this.fillArticle(article, node, hub, presentation);
        for (const button of article.querySelectorAll<HTMLButtonElement>(
          'button[data-target^="act:fps"]',
        )) {
          const rate = frameRateFromAction(button.dataset.target!.slice(4));
          const selected = String(rate === s.settings.frameRate);
          if (button.getAttribute("aria-pressed") !== selected)
            button.setAttribute("aria-pressed", selected);
        }
        visible.add(node.id);
        article.hidden = false;
        article.inert = !!s.passage || surface < 0.55;
        article.setAttribute("aria-hidden", String(article.inert));
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
        article.style.width = `${small ? Math.min(295, Math.max(200, s.viewport.width * 0.72)) : Math.min(355, Math.max(265, s.viewport.width * 0.29))}px`;
        const heightKey = JSON.stringify([
          node.id,
          presentation,
          article.style.width,
        ]);
        let height = this.heights.get(heightKey);
        if (height === undefined) {
          height = article.offsetHeight || 160;
          this.heights.set(heightKey, height);
        }
        const y = point.y - height / 2 + 44 * depth,
          angle = (Math.atan2(n.y, n.x) * 180) / Math.PI;
        article.style.transform = `translate3d(${point.x}px,${y}px,0) rotate(${angle}deg) scale(${0.72 + 0.28 * surface})`;
        const blur = 8.5 * depth ** 1.12 * s.settings.blur;
        article.style.filter =
          s.settings.reducedMotion || blur < 0.08 ? "none" : `blur(${blur}px)`;
        article.style.opacity = String(surface ** 1.2);
        article.style.pointerEvents = article.inert ? "none" : "auto";
      });
    for (const [id, article] of this.articles)
      if (!visible.has(id)) {
        article.hidden = true;
        article.inert = true;
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
