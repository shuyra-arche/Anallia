import { ArticleRenderer } from "./article.ts";
import { LocalLabelTurns } from "./local-labels.ts";
import { placeReading, readingHeight, readingWidth } from "../core/layout.ts";
import { frameRateFromAction } from "../core/frame-rate.ts";
import { backgroundFromAction } from "../core/background.ts";
import type {
  Chapter,
  Command,
  FieldState,
  Hub,
  Settings,
  Vec,
} from "../core/types.ts";
import { ease, clamp, rot } from "../core/math.ts";
import {
  readingEnvelope,
  morphReadingEnvelope,
  pageTurnPose,
} from "../core/transitions.ts";
import type { PagePose } from "../core/transitions.ts";
import { PAPER, BOUNDARY, blendHex, needsColorSweep } from "../core/palette.ts";
import {
  ICON_TOKENS,
  classifyLabelContent,
  resolveIconToken,
} from "../core/icons.ts";
import type { IconToken } from "../core/icons.ts";
import { resolveSymbolKind } from "../core/symbol-morph.ts";
import type { SymbolGeometry, SymbolKind } from "../core/symbol-morph.ts";
import { Catalog } from "../content/catalog.ts";
import {
  ordinaryAndLocalAttachments,
  globalAttachments,
  resolveGlobalHostHub,
} from "../application/attachments.ts";
import { projectAttachment } from "../geometry/attachments.ts";
import type { FieldAttachment } from "../core/attachments.ts";
import {
  evaluateHubGeometry,
  passageGeometry,
  remotePortalGeometry,
  material,
  outwardNormal,
  nodeS,
  hubToScreen,
} from "../geometry/field.ts";
import { svg, requireElement } from "./dom.ts";

/** Camera zoom threshold below which focused hub global tags yield to the traditional HUD bar. */
export const TRADITIONAL_HUD_ZOOM_THRESHOLD = 0.45;

interface Label {
  group: SVGGElement;
  leaf: SVGGElement;
  pin: SVGCircleElement;
  stem: SVGPathElement;
  ring: SVGCircleElement;
  icon: SVGSVGElement;
  iconGlyph: SVGGElement;
  text: SVGTextElement;
  hit: SVGRectElement;
  renderedIconId?: string;
  renderedSymbolSignature?: string;
  symbolPaths?: Map<string, SVGPathElement>;
  symbolPoints?: Map<string, SVGCircleElement>;
}

export interface SymbolInteractionState {
  hover: boolean;
  focus: boolean;
  press: boolean;
  active: boolean;
}

function populateIconGlyph(target: SVGGElement, token: IconToken) {
  target.replaceChildren();
  const strokeWidth = (
    token.baseStrokeWidth + token.strokeCompensation
  ).toFixed(2);
  const dx = (-12 + token.opticalOffset.x).toFixed(2);
  const dy = (-12 + token.opticalOffset.y).toFixed(2);
  target.setAttribute(
    "transform",
    `translate(12 12) scale(${token.opticalScale}) translate(${dx} ${dy})`,
  );
  target.setAttribute("stroke-width", strokeWidth);
  for (const shape of token.shapes) {
    svg(shape.tag, target, shape.attrs);
  }
}

/**
 * Render or update a dynamic SymbolGeometry in-place inside `target` (<g class="label-icon-glyph">),
 * preserving existing <path> and <circle> DOM nodes across all intermediate morph frames m ∈ [0, 1].
 */
export function renderSymbolGeometryToGroup(
  target: SVGGElement,
  geom: SymbolGeometry,
  pathCache?: Map<string, SVGPathElement>,
  pointCache?: Map<string, SVGCircleElement>,
) {
  const { optical } = geom;
  const baseStroke = optical.baseStrokeWidth + optical.strokeCompensation;
  const dx = (-12 + optical.opticalOffset.x).toFixed(2);
  const dy = (-12 + optical.opticalOffset.y).toFixed(2);
  target.setAttribute(
    "transform",
    `translate(12 12) scale(${optical.opticalScale}) translate(${dx} ${dy})`,
  );
  target.setAttribute("stroke-width", baseStroke.toFixed(2));
  target.dataset.symbolKind = geom.kind;
  target.dataset.symbolMorph = geom.morph.toFixed(4);
  target.dataset.symbolActivity = geom.activity.toFixed(3);

  const canReuse =
    pathCache &&
    pointCache &&
    pathCache.size === geom.paths.length &&
    pointCache.size === geom.points.length &&
    geom.paths.every((p) => pathCache.has(p.id)) &&
    geom.points.every((pt) => pointCache.has(pt.id));

  if (!canReuse) {
    target.replaceChildren();
    pathCache?.clear();
    pointCache?.clear();
    for (const p of geom.paths) {
      const el = svg("path", target, {
        class: `symbol-path is-${p.role}`,
        "data-part-id": p.id,
        d: p.d,
        fill: "none",
      });
      if (p.strokeScale !== undefined) {
        el.setAttribute(
          "stroke-width",
          (baseStroke * p.strokeScale).toFixed(2),
        );
      }
      if (p.opacity !== undefined) {
        el.setAttribute("opacity", p.opacity.toFixed(3));
      }
      pathCache?.set(p.id, el);
    }
    for (const pt of geom.points) {
      const el = svg("circle", target, {
        class: `symbol-point is-${pt.role}`,
        "data-part-id": pt.id,
        cx: pt.x.toFixed(3),
        cy: pt.y.toFixed(3),
        r: pt.r.toFixed(3),
        fill: pt.filled !== false ? "currentColor" : "none",
        stroke: pt.filled !== false ? "none" : "currentColor",
      });
      if (pt.opacity !== undefined) {
        el.setAttribute("opacity", pt.opacity.toFixed(3));
      }
      pointCache?.set(pt.id, el);
    }
    return;
  }

  for (const p of geom.paths) {
    const el = pathCache!.get(p.id)!;
    el.setAttribute("d", p.d);
    if (p.strokeScale !== undefined) {
      el.setAttribute("stroke-width", (baseStroke * p.strokeScale).toFixed(2));
    }
  }
  for (const pt of geom.points) {
    const el = pointCache!.get(pt.id)!;
    el.setAttribute("cx", pt.x.toFixed(3));
    el.setAttribute("cy", pt.y.toFixed(3));
    el.setAttribute("r", pt.r.toFixed(3));
  }
}

function isActionPressed(
  action: string,
  settings: Settings,
): boolean | undefined {
  const background = backgroundFromAction(action);
  if (background !== undefined) return background === settings.background;
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
  private hudControls: HTMLElement;
  private hubs = new Map<
    string,
    {
      path: SVGPathElement;
      hit: SVGPathElement;
      tracePath: SVGPathElement;
      traceDot: SVGCircleElement;
      labels: Map<string, Label>;
    }
  >();
  readingBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null = null;
  private articles = new Map<string, HTMLElement>();
  readonly actions = new Map<string, Command>();
  private lastRenderKey = "";
  private lastState: FieldState | null = null;
  private heights = new Map<string, number>();
  private measuredSettings = "";
  private readonly articleRenderer: ArticleRenderer;
  private readonly localLabelTurns = new LocalLabelTurns();
  private symbolFeedback = new Map<string, SymbolInteractionState>();

  invalidateLayout() {
    this.heights.clear();
    this.lastRenderKey = "";
  }

  get isAnimating(): boolean {
    return this.localLabelTurns.isAnimating;
  }

  private host: HTMLElement;
  private catalog: Catalog;
  constructor(host: HTMLElement, catalog: Catalog) {
    this.articleRenderer = new ArticleRenderer(catalog, {
      inlineIcon: (token, morph) => this.createInlineIconSvg(token, morph),
      iconShowcase: (hub) => this.buildIconShowcase(hub),
    });
    this.host = host;
    this.catalog = catalog;
    this.root = requireElement(host, "#world");
    this.geometry = requireElement(host, "#gGeometry");
    this.labels = requireElement(host, "#gLabels");
    this.reading = requireElement(host, "#reading");
    this.hudControls = this.ensureHudControls(host);
    for (const hub of catalog.definitions)
      this.hubs.set(hub.id, {
        path: svg("path", this.geometry, { class: "curve" }),
        tracePath: svg("path", this.geometry, { class: "inner-trace" }),
        traceDot: svg("circle", this.geometry, {
          class: "inner-dot",
          r: 2.2,
        }),
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
    this.bindSymbolFeedbackListeners();
  }

  private ensureHudControls(host: HTMLElement): HTMLElement {
    let nav = host.querySelector<HTMLElement>("#hudControls");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "hudControls";
      nav.className = "hud-controls";
      nav.setAttribute("aria-label", "全域与传统全局索引");
      nav.hidden = true;
      const items: Array<{ key: string; label: string; title: string }> = [
        { key: "hud:back", label: "↶ 返回", title: "返回上一位置" },
        { key: "hud:overview", label: "⊙ 全域", title: "切换全域观察" },
        { key: "hud:refocus", label: "⌖ 聚焦", title: "回到聚焦枢" },
        { key: "hud:search", label: "⌕ 检索", title: "打开检索枢" },
        { key: "hud:settings", label: "⚙ 设置", title: "打开设置枢" },
        { key: "hud:loading", label: "◌ 加载", title: "演练加载动效" },
      ];
      for (const item of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hud-btn";
        btn.dataset.command = item.key;
        btn.title = item.title;
        btn.setAttribute("aria-label", item.label);
        const glyph = Array.from(item.label)[0];
        const token = resolveIconToken(glyph);
        if (token)
          btn.append(
            this.createInlineIconSvg(token),
            document.createTextNode(item.label.slice(glyph.length)),
          );
        else btn.textContent = item.label;
        nav.append(btn);
      }
      host.append(nav);
    }
    return nav;
  }

  private bindSymbolFeedbackListeners() {
    const resolveTagKey = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const group = target.closest<SVGGElement>(".tag-group[data-symbol-kind]");
      return group?.dataset.command ?? null;
    };
    this.labels.addEventListener("pointerover", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { hover: true });
    });
    this.labels.addEventListener("pointerout", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { hover: false, press: false });
    });
    this.labels.addEventListener("pointerdown", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { press: true });
    });
    this.labels.addEventListener("pointerup", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { press: false });
    });
    this.labels.addEventListener("focusin", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { focus: true });
    });
    this.labels.addEventListener("focusout", (e) => {
      const key = resolveTagKey(e.target);
      if (key) this.setSymbolInteraction(key, { focus: false, press: false });
    });
  }

  /**
   * Update orthogonal interaction feedback state (Hover / Focus / Press / Active)
   * on a Symbol Morph icon without altering the host Hub's morph or camera state.
   */
  setSymbolInteraction(
    commandKey: string,
    patch: Partial<SymbolInteractionState>,
  ) {
    const current = this.symbolFeedback.get(commandKey) ?? {
      hover: false,
      focus: false,
      press: false,
      active: false,
    };
    const next: SymbolInteractionState = { ...current, ...patch };
    this.symbolFeedback.set(commandKey, next);
    if (this.lastState) {
      this.lastRenderKey = "";
      this.render(this.lastState);
    }
  }

  getSymbolActivity(
    commandKey: string,
    kind: SymbolKind,
    s?: FieldState | null,
  ): number {
    const fb = this.symbolFeedback.get(commandKey);
    const semanticActive =
      fb?.active ||
      Boolean(
        s &&
        ((kind === "overview" && s.overview) ||
          (kind === "search" && !s.overview && s.focus === "Q") ||
          (kind === "settings" && !s.overview && s.focus === "S")),
      );
    let activity = semanticActive ? 0.35 : 0;
    if (fb?.hover || fb?.focus) activity = Math.max(activity, 0.62);
    if (fb?.press) activity = 1.0;
    return clamp(activity, 0, 1);
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
    page: PagePose | null = null,
    attachment?: FieldAttachment,
    state?: FieldState,
  ) {
    const pool = this.hubs.get(hub.id)!.labels;
    let entry = pool.get(key);
    if (!entry) {
      const group = svg("g", this.labels, {
        class: "tag-group",
        tabindex: 0,
        role: "button",
      });
      const pin = svg("circle", group, {
        class: "page-pin",
        cx: 0,
        cy: 0,
        r: 2.6,
      });
      const leaf = svg("g", group, { class: "page-leaf" });
      const stem = svg("path", leaf);
      const ring = svg("circle", leaf, { class: "label-ring", r: 16 });
      const icon = svg("svg", leaf, {
        class: "label-icon",
        viewBox: "0 0 24 24",
        width: 20,
        height: 20,
        x: -10,
        y: -10,
        overflow: "visible",
      });
      const iconGlyph = svg("g", icon, { class: "label-icon-glyph" });
      const text = svg("text", leaf);
      const hit = svg("rect", leaf, { class: "label-hit", height: 44, rx: 8 });
      entry = {
        group,
        leaf,
        pin,
        stem,
        ring,
        icon,
        iconGlyph,
        text,
        hit,
        symbolPaths: new Map(),
        symbolPoints: new Map(),
      };
      pool.set(key, entry);
    }
    const e = entry,
      id = `${hub.id}:${key}`;
    const interactive = !page || page.interactive;
    if (interactive) this.actions.set(id, command);
    e.group.style.display = "";
    e.group.style.opacity = alpha < 0.999 ? String(alpha) : "";
    const zoom = state?.camera.z ?? 1;
    e.group.setAttribute(
      "transform",
      `translate(${anchor.x} ${anchor.y}) scale(${zoom})`,
    );
    e.group.classList.toggle("turning", !!page);
    e.pin.style.opacity = page && kind === "current" ? "1" : "0";
    e.hit.style.pointerEvents = interactive ? "" : "none";
    e.group.setAttribute("tabindex", interactive ? "0" : "-1");
    e.group.setAttribute("aria-hidden", interactive ? "false" : "true");
    e.group.dataset.command = id;
    if (attachment) {
      e.group.dataset.scope = attachment.scope;
      e.group.dataset.role = attachment.role;
      e.group.dataset.anchor = attachment.anchor.id;
      e.group.dataset.hostHub = attachment.anchor.hostHub;
      e.group.dataset.side = attachment.side;
    }
    if (key.startsWith("local:")) e.group.dataset.localScroll = hub.id;
    else delete e.group.dataset.localScroll;
    e.group.classList.toggle("is-current", kind === "current");
    e.group.setAttribute("aria-label", aria);

    const deltaX = (at.x - anchor.x) / zoom,
      deltaY = (at.y - anchor.y) / zoom;
    const dist = Math.hypot(deltaX, deltaY);
    const stemTier =
      attachment?.role === "operation"
        ? "global"
        : attachment?.role === "local"
          ? "local"
          : kind === "current"
            ? "current"
            : "ordinary";
    const stemEnd = Math.max(4, dist - 14);
    const sx = dist > 1e-4 ? (deltaX / dist) * stemEnd : deltaX;
    const sy = dist > 1e-4 ? (deltaY / dist) * stemEnd : deltaY;
    e.stem.setAttribute(
      "class",
      `stem stem-${stemTier}${kind === "nav" ? " nav" : ""}`,
    );
    e.stem.dataset.stemTier = stemTier;
    e.stem.dataset.stemLength = stemEnd.toFixed(1);
    e.stem.setAttribute("d", `M0 0L${sx.toFixed(2)} ${sy.toFixed(2)}`);

    const stemAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
    const flip = page ? page.squash : 1;
    e.leaf.setAttribute(
      "transform",
      `rotate(${stemAngle}) scale(${flip} 1) rotate(${-stemAngle})`,
    );
    e.leaf.style.opacity = page ? String(page.opacity) : "";
    while (degree > 90) degree -= 180;
    while (degree < -90) degree += 180;
    // Label geometry stays local; the parent scales typography, icons and hit targets together.
    const labelTransform = `translate(${deltaX} ${deltaY}) rotate(${degree})`;
    e.ring.setAttribute("cx", "0");
    e.ring.setAttribute("cy", "0");
    e.ring.setAttribute("transform", labelTransform);

    const symbolKind =
      attachment?.symbolKind ??
      (attachment?.scope === "global" ? resolveSymbolKind(name) : undefined);
    const iconToken = attachment?.icon ?? resolveIconToken(name);
    const contentKind =
      attachment?.contentKind ??
      (symbolKind || iconToken ? "icon" : classifyLabelContent(name));
    e.group.dataset.contentKind = contentKind;
    e.group.classList.toggle("has-icon", Boolean(symbolKind || iconToken));

    if (iconToken) {
      if (symbolKind) e.group.dataset.symbolKind = symbolKind;
      else delete e.group.dataset.symbolKind;
      const fb = this.symbolFeedback.get(id);
      e.group.classList.toggle("is-hovered", Boolean(fb?.hover));
      e.group.classList.toggle("is-pressed", Boolean(fb?.press));
      e.group.classList.toggle("is-focused", Boolean(fb?.focus));
      e.group.classList.toggle(
        "is-active-symbol",
        Boolean(
          symbolKind && this.getSymbolActivity(id, symbolKind, state) >= 0.35,
        ),
      );
      e.group.dataset.icon = iconToken.iconName;
      e.icon.style.display = "";
      e.icon.setAttribute("class", `label-icon ${kind}`);
      e.icon.setAttribute("transform", labelTransform);
      if (e.renderedIconId !== iconToken.id) {
        populateIconGlyph(e.iconGlyph, iconToken);
        e.renderedIconId = iconToken.id;
      }
      e.text.setAttribute("class", `label ${kind} is-sr-only`);
      e.text.textContent = name;
      e.text.setAttribute("transform", labelTransform);
    } else {
      delete e.group.dataset.symbolKind;
      delete e.group.dataset.symbolMorph;
      delete e.group.dataset.symbolActivity;
      delete e.group.dataset.icon;
      e.icon.style.display = "none";
      const subClass = contentKind === "symbol" ? "is-symbol" : "is-text";
      e.text.setAttribute("class", `label ${kind} ${subClass}`);
      e.text.setAttribute("x", "0");
      e.text.setAttribute("y", "0");
      e.text.textContent = name;
      e.text.setAttribute("transform", labelTransform);
    }

    const width =
      symbolKind || iconToken ? 44 : Math.max(44, name.length * 14 + 20);
    e.hit.setAttribute("x", String(-width / 2));
    e.hit.setAttribute("y", "-22");
    e.hit.setAttribute("width", String(width));
    e.hit.setAttribute("transform", labelTransform);
  }

  private renderUnfocusedTraces(h: Hub, nodes: Chapter[], s: FieldState) {
    const entry = this.hubs.get(h.id)!;
    if (s.loading || (h.id === s.focus && !s.overview)) {
      entry.tracePath.setAttribute("d", "");
      entry.tracePath.style.display = "none";
      entry.traceDot.style.display = "none";
      return;
    }
    const segs: string[] = [];
    const activeIdx =
      ((Math.round(h.scroll) % nodes.length) + nodes.length) % nodes.length;
    let dotPt: Vec | null = null;
    for (let j = 0; j < nodes.length; j++) {
      const param = nodeS(h, j, nodes.length, s.camera, s.viewport);
      const p0 = hubToScreen(h, material(h, param, 0), s.camera, s.viewport);
      const isSelected = j === activeIdx;
      const tickLen = isSelected ? -24 : -14;
      const p1 = hubToScreen(
        h,
        material(h, param, tickLen),
        s.camera,
        s.viewport,
      );
      segs.push(
        `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}L${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      );
      if (isSelected) {
        dotPt = hubToScreen(h, material(h, param, -29), s.camera, s.viewport);
      }
    }
    entry.tracePath.style.display = "";
    entry.tracePath.setAttribute("d", segs.join(""));
    if (dotPt) {
      entry.traceDot.style.display = "";
      entry.traceDot.setAttribute("cx", dotPt.x.toFixed(2));
      entry.traceDot.setAttribute("cy", dotPt.y.toFixed(2));
      entry.traceDot.setAttribute("r", String(2.2 * s.camera.z));
    } else {
      entry.traceDot.style.display = "none";
    }
  }

  private updateHudControls(s: FieldState, showTraditionalHud: boolean) {
    this.actions.set("hud:back", { type: "back" });
    this.actions.set("hud:overview", { type: "overview" });
    this.actions.set("hud:refocus", { type: "focus", hub: s.focus });
    this.actions.set("hud:search", { type: "navigate", target: "q0" });
    this.actions.set("hud:settings", { type: "navigate", target: "s0" });
    this.actions.set("hud:loading", { type: "loading" });

    this.hudControls.hidden = !showTraditionalHud || s.loading;
    if (!showTraditionalHud || s.loading) return;

    const backBtn = this.hudControls.querySelector<HTMLButtonElement>(
      '[data-command="hud:back"]',
    );
    if (backBtn) backBtn.disabled = s.history.length === 0;
    const overviewBtn = this.hudControls.querySelector<HTMLButtonElement>(
      '[data-command="hud:overview"]',
    );
    if (overviewBtn)
      overviewBtn.setAttribute("aria-pressed", String(s.overview));
  }

  render(s: FieldState) {
    this.lastState = s;
    const focusedHub = s.hubs[s.focus];
    const focusedEntries =
      s.overview || s.loading
        ? []
        : ordinaryAndLocalAttachments(
            focusedHub,
            this.selected(focusedHub),
            this.catalog.siblings(
              this.selected(focusedHub).id,
              s.searchResults,
            ),
            s.camera,
            s.viewport,
          );
    const locals = this.localLabelTurns.update(
      `${s.focus}:${this.selected(focusedHub).id}`,
      s.passage ? [] : focusedEntries.filter((entry) => entry.role === "local"),
      s.elapsed,
      s.settings.reducedMotion,
    );
    const feedbackSig = [...this.symbolFeedback.entries()].map(([k, v]) => [
      k,
      v.hover,
      v.focus,
      v.press,
      v.active,
    ]);
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
      s.morphTurn?.phase,
      s.contentTurn?.phase,
      feedbackSig,
      locals.map((leaf) => [
        leaf.attachment.anchor.id,
        leaf.visibility,
        leaf.phase,
      ]),
      Object.values(s.hubs).map((h) => [
        h.id,
        h.angle,
        h.anchorOffset,
        h.readingBearing,
        h.morph,
        h.fold,
        h.scroll,
        h.localScroll,
        h.textOffset,
        h.path,
      ]),
    ]);
    if (key === this.lastRenderKey) return;
    this.lastRenderKey = key;
    this.host.style.setProperty("--camera-scale", String(s.camera.z));
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

    const contentTurn = s.contentTurn;
    const turnPose = contentTurn
      ? pageTurnPose(
          contentTurn.phase,
          s.settings.reducedMotion,
          contentTurn.direction,
        )
      : null;
    const chapterEnvelope = s.passage ? readingEnvelope(s.passage.phase) : 1;

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
      const current = this.selected(h);
      const nodes = this.catalog.siblings(current.id, s.searchResults);
      this.renderUnfocusedTraces(h, nodes, s);

      if (s.loading || !active) continue;

      const materialSide: 1 | -1 = 1;
      for (const attachment of focusedEntries) {
        if (attachment.role === "local") continue;
        const point = projectAttachment(
          h,
          attachment,
          s.camera,
          s.viewport,
          materialSide,
        );
        this.label(
          h,
          attachment.id,
          attachment.glyph,
          point.position,
          point.hinge,
          attachment.visual,
          point.degree,
          attachment.command,
          attachment.aria,
          attachment.opacity * chapterEnvelope,
          contentTurn?.hub === h.id ? turnPose : null,
          attachment,
          s,
        );
      }
    }

    for (const leaf of locals) {
      const attachment = leaf.attachment;
      const hub = s.hubs[attachment.anchor.hostHub];
      const point = projectAttachment(hub, attachment, s.camera, s.viewport, 1);
      this.label(
        hub,
        attachment.anchor.id,
        attachment.glyph,
        point.position,
        point.hinge,
        attachment.visual,
        point.degree,
        attachment.command,
        attachment.aria,
        attachment.opacity,
        leaf.pose,
        attachment,
        s,
      );
      this.hubs
        .get(hub.id)!
        .labels.get(attachment.anchor.id)!.group.dataset.localPhase =
        leaf.phase;
    }

    const useTraditionalHud =
      s.overview || s.camera.z < TRADITIONAL_HUD_ZOOM_THRESHOLD;
    this.updateHudControls(s, useTraditionalHud);

    if (!s.loading && !useTraditionalHud) {
      const owner = resolveGlobalHostHub(s);
      const materialSide: 1 | -1 = 1;
      for (const attachment of globalAttachments(s, this.catalog)) {
        const point = projectAttachment(
          owner,
          attachment,
          s.camera,
          s.viewport,
          materialSide,
        );
        // Global operation labels do NOT animate or fade during hub-switching passage.
        this.label(
          owner,
          attachment.id,
          attachment.glyph,
          point.position,
          point.hinge,
          attachment.visual,
          point.degree,
          attachment.command,
          attachment.aria,
          attachment.opacity,
          null,
          attachment,
          s,
        );
      }
    }
    this.renderTexts(s);
    this.labels.style.opacity = "";
    this.labels.style.pointerEvents = s.passage ? "none" : "";
    const visualTheme =
      s.passage && s.passage.phase >= 0.5 ? s.passage.theme : s.theme;
    this.host.ownerDocument.documentElement.dataset.theme = visualTheme;
    const t = s.passage;
    const bgMix = t ? ease(clamp((t.phase - 0.42) / 0.58, 0, 1)) : 1;
    requireElement(this.host, "#baseBg").setAttribute(
      "fill",
      t
        ? blendHex(PAPER[t.sourceTheme], PAPER[t.theme], bgMix)
        : PAPER[s.theme],
    );
    const portal = requireElement<SVGGElement>(this.host, "#portalViewport"),
      stroke = requireElement<SVGPathElement>(this.host, "#portalStroke"),
      echo = requireElement<SVGPathElement>(this.host, "#portalEchoStroke");
    if (t) {
      this.host.dataset.transition = "passage";
      this.host.dataset.transitionKind = t.kind;
      this.host.dataset.direction = t.direction;
    } else {
      delete this.host.dataset.transition;
      delete this.host.dataset.transitionKind;
      delete this.host.dataset.direction;
    }
    if (t && needsColorSweep(t.sourceTheme, t.theme)) {
      const geometry = passageGeometry(t, s.camera, s.viewport);
      portal.setAttribute("visibility", "visible");
      const portalAlpha =
        ease(clamp(t.phase / 0.12, 0, 1)) *
        ease(clamp((1 - t.phase) / 0.12, 0, 1));
      portal.style.opacity = String(portalAlpha);
      requireElement(this.host, "#portalBoundaryPath").setAttribute(
        "d",
        geometry.sweptClipD,
      );
      requireElement(this.host, "#portalBg").setAttribute(
        "fill",
        PAPER[t.theme],
      );
      stroke.setAttribute("d", geometry.strokeD);
      stroke.setAttribute("stroke", BOUNDARY[t.theme]);
      stroke.style.opacity = String(Math.sin(t.phase * Math.PI) * 0.82);
      if (t.kind === "remote" || t.kind === "axis") {
        const delayed = remotePortalGeometry(
          clamp(t.phase - 0.055, 0, 1),
          s.camera,
          s.viewport,
        );
        echo.setAttribute("d", delayed.strokeD);
        echo.setAttribute("stroke", BOUNDARY[t.sourceTheme]);
        echo.style.opacity = String(Math.sin(t.phase * Math.PI) * 0.26);
      } else {
        echo.style.opacity = "0";
      }
    } else {
      portal.setAttribute("visibility", "hidden");
      stroke.style.opacity = "0";
      echo.style.opacity = "0";
    }
    requireElement<HTMLElement>(this.host, "#descBar").textContent =
      s.description;
  }
  private createInlineIconSvg(token: IconToken, _hubMorph = 0): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(ns, "svg");
    svgEl.setAttribute("class", "inline-svg-icon");
    svgEl.setAttribute("viewBox", token.viewBox);
    svgEl.setAttribute("width", "15");
    svgEl.setAttribute("height", "15");
    svgEl.setAttribute("aria-hidden", "true");
    svgEl.setAttribute("fill", "none");
    svgEl.setAttribute("stroke", "currentColor");
    svgEl.setAttribute("stroke-linecap", "round");
    svgEl.setAttribute("stroke-linejoin", "round");
    const g = document.createElementNS(ns, "g");
    populateIconGlyph(g, token);
    svgEl.append(g);
    return svgEl;
  }
  private buildIconShowcase(_hub: Hub): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "icon-showcase-grid";
    for (const token of Object.values(ICON_TOKENS)) {
      const card = document.createElement("div");
      card.className = "icon-showcase-card";
      card.append(this.createInlineIconSvg(token));
      const label = document.createElement("span");
      label.textContent = token.label;
      card.append(label);
      grid.append(card);
    }
    return grid;
  }
  private renderTexts(s: FieldState) {
    this.readingBounds = null;
    const hub = s.hubs[s.focus],
      nodes = this.catalog.siblings(this.selected(hub).id, s.searchResults),
      morph = ease(clamp(hub.morph, 0, 1));
    const p = s.passage?.phase,
      fold = p === undefined ? 1 : readingEnvelope(p),
      contentTurn = s.contentTurn?.hub === hub.id ? s.contentTurn : null,
      page = contentTurn
        ? pageTurnPose(
            contentTurn.phase,
            s.settings.reducedMotion,
            contentTurn.direction,
          )
        : null,
      expressionOpacity = page ? page.opacity : morphReadingEnvelope(hub.morph);
    const visible = new Set<string>();
    if (!s.overview && !s.loading)
      nodes.forEach((node, i) => {
        const surface =
          ease(clamp(1 - Math.abs(i - hub.scroll) / s.settings.range, 0, 1)) *
          fold *
          expressionOpacity;
        if (surface < 0.015) return;
        const article = this.articles.get(node.id)!,
          depth = 1 - surface,
          presentation = morph > 0.5 ? "line" : "circle";
        if (article.dataset.presentation !== presentation)
          this.articleRenderer.fillArticle(article, node, hub, presentation);
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
        const inert = !!s.passage || !!page || surface < 0.55;
        if (Boolean(article.inert) !== inert) article.inert = inert;
        const ariaHidden = String(inert);
        if (article.getAttribute("aria-hidden") !== ariaHidden)
          article.setAttribute("aria-hidden", ariaHidden);
        const position = nodeS(hub, i, nodes.length, s.camera, s.viewport);
        // Typography stays upright while its reading window follows the outward normal.
        const anchorPt = hubToScreen(
          hub,
          material(hub, position, 76),
          s.camera,
          s.viewport,
        );
        const isLong = article.classList.contains("is-long");
        const widthPx = readingWidth(s.viewport, isLong);
        const widthStr = `${widthPx.toFixed(1)}px`;
        if (article.style.width !== widthStr) article.style.width = widthStr;
        const heightKey = JSON.stringify([node.id, presentation, widthStr]);
        let height = this.heights.get(heightKey);
        if (height === undefined) {
          height =
            article.querySelector<HTMLElement>(".note-content")!.offsetHeight ||
            160;
          this.heights.set(heightKey, height);
        }
        const panelHeight = Math.min(
          height,
          readingHeight(s.viewport, s.camera.z),
        );
        const panelHeightStr = `${panelHeight.toFixed(1)}px`;
        if (article.style.height !== panelHeightStr)
          article.style.height = panelHeightStr;
        const maxFloat = Math.max(0, height - panelHeight);
        const maxFloatStr = String(Math.round(maxFloat));
        if (article.dataset.maxFloat !== maxFloatStr)
          article.dataset.maxFloat = maxFloatStr;
        const activeFloat =
          Math.abs(i - hub.scroll) < 0.6
            ? clamp(hub.textOffset, 0, maxFloat)
            : 0;
        const content = article.querySelector<HTMLElement>(".note-content")!;
        const floatTransform = `translateY(${-activeFloat.toFixed(2)}px)`;
        if (content.style.transform !== floatTransform)
          content.style.transform = floatTransform;
        const normal = rot(
          outwardNormal(hub, position),
          (s.camera.rotation * Math.PI) / 180,
        );
        const placement = placeReading(
          anchorPt,
          normal,
          widthPx,
          panelHeight,
          s.camera.z,
        );
        if (article.dataset.side !== placement.side)
          article.dataset.side = placement.side;
        const anchorVarStr = `${placement.originY.toFixed(1)}px`;
        if (article.style.getPropertyValue("--anchor-y") !== anchorVarStr)
          article.style.setProperty("--anchor-y", anchorVarStr);
        const originStr = `${placement.originX.toFixed(3)}px ${placement.originY.toFixed(3)}px`;
        if (article.style.transformOrigin !== originStr)
          article.style.transformOrigin = originStr;
        const targetLeft = placement.left + 18 * depth * s.camera.z;
        const targetTop = placement.top + 32 * depth * s.camera.z;
        const turnY = page?.angle ?? 0;
        const transformStr = `translate3d(${(targetLeft + (s.camera.z - 1) * placement.originX).toFixed(2)}px,${(targetTop + (s.camera.z - 1) * placement.originY).toFixed(2)}px,0) scale(${s.camera.z}) rotateY(${turnY.toFixed(2)}deg)`;
        if (article.style.transform !== transformStr)
          article.style.transform = transformStr;
        if (node.id === this.selected(hub).id)
          this.readingBounds = {
            left: targetLeft,
            top: targetTop,
            width: widthPx * s.camera.z,
            height: panelHeight * s.camera.z,
          };
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
    this.localLabelTurns.clear();
    this.geometry.replaceChildren();
    this.labels.replaceChildren();
    this.reading.replaceChildren();
    this.hudControls.remove();
    this.actions.clear();
  }
}
