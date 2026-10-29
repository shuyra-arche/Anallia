import type { FieldState, Hub, Settings, Theme } from "../core/types.ts";
import type { ReadingFrame } from "../core/graphics.ts";
import { Catalog } from "../content/catalog.ts";
import { ease, clamp, rot } from "../core/math.ts";
import { frameRateFromAction } from "../core/frame-rate.ts";
import { backgroundFromAction } from "../core/background.ts";
import { themeFromAction } from "../core/palette.ts";
import { placeReading, readingHeight, readingWidth, resolveReadingClip } from "../core/layout.ts";
import { readingEnvelope, morphReadingEnvelope, pageTurnPose } from "../core/transitions.ts";
import { computeHubVerticalClearance, material, outwardNormal, nodeS, hubToScreen } from "../geometry/field.ts";
import { ArticleRenderer } from "./article.ts";
import type { ArticleVisuals } from "./article.ts";
import { ReadingPositions, applyReadingClip } from "./reading-positions.ts";
import type { ReadingCorrection } from "./reading-positions.ts";
import { requireElement } from "./dom.ts";

function isActionPressed(
  action: string,
  settings: Settings,
  theme: Theme,
): boolean | undefined {
  const selectedTheme = themeFromAction(action);
  if (selectedTheme !== undefined) return selectedTheme === theme;
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
    case "toggle_sound":
      return settings.sound !== false;
    default:
      return undefined;
  }
}

/** Owns DOM articles, measurement, source positions and the bounded article cache. */
export class ReadingLayer {
  readingBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null = null;
  private destroyed = false;
  private articles = new Map<string, HTMLElement>();
  private heights = new Map<string, number>();
  readonly readingPositions = new ReadingPositions();
  private readingCorrections: ReadingCorrection[] = [];
  private readingSettling = false;
  private readingWindows = new Map<string, { geometry: string; height: number; held: boolean }>();
  private measuredSettings = "";
  readonly articleRenderer: ArticleRenderer;
  private contentProbe: HTMLElement | null = null;
  private lastState: FieldState | null = null;
  private readonly host: HTMLElement;
  private readonly catalog: Catalog;
  private readonly reading: HTMLElement;
  constructor(host: HTMLElement, catalog: Catalog, visuals: ArticleVisuals) {
    this.host = host;
    this.catalog = catalog;
    this.reading = requireElement(host, "#reading");
    this.articleRenderer = new ArticleRenderer(catalog, visuals);
  }
  get isSettling(): boolean { return this.readingSettling; }
  private selected(hub: Hub) { return this.catalog.get(hub.path.at(-1)!); }
  invalidateContent(ids: readonly string[]): void {
    const targets = new Set([...ids, ...ids.map((id) => `q_hit_${id}`)]);
    for (const key of this.heights.keys()) {
      if (targets.has(JSON.parse(key)[0])) this.heights.delete(key);
    }
  }

  prepareContent(id: string, presentation: "circle" | "line"): boolean {
    if (this.destroyed) return false;
    const node = this.catalog.get(id);
    const document = this.catalog.document(id, presentation);
    if (!document.blocks.length) return document.complete;
    const probe = this.contentProbe ??= this.host.ownerDocument.createElement("div");
    if (!probe.parentNode) {
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;transform:none;height:auto;filter:none";
      probe.append(this.host.ownerDocument.createElement("p"));
      this.reading.append(probe);
    }
    const long = document.blocks.length > 1 || document.source.length > 220 || !document.complete;
    probe.className = `note note-measure${long ? " is-long" : ""}`;
    const width = readingWidth(this.lastState?.viewport ?? { width: this.host.clientWidth, height: this.host.clientHeight }, long);
    probe.style.width = `${width}px`;
    const tail = document.blocks.at(-1)!;
    const paragraph = probe.firstElementChild as HTMLElement;
    const text = tail.inline.map(inline => inline.text).join("");
    if (paragraph.textContent !== text) paragraph.textContent = text;
    const height = this.articleRenderer.estimateArticleHeight(probe, node, presentation, width, blockId => blockId === tail.id && tail.kind === "paragraph" ? paragraph.offsetHeight : 0);
    return Number.isFinite(height) && height > 0 && (tail.stable || tail.kind === "icons" || paragraph.offsetHeight > 0);
  }

  takeReadingCorrections(): ReadingCorrection[] {
    const corrections = this.readingCorrections;
    this.readingCorrections = [];
    return corrections;
  }

  invalidateLayout(fontsChanged = false) {
    this.readingPositions.invalidate();
    if (fontsChanged) {
      this.articleRenderer.invalidateFonts();
    }
    this.heights.clear();
  }

  private articleFor(id: string): HTMLElement {
    let article = this.articles.get(id);
    if (!article) {
      article = this.host.ownerDocument.createElement("article");
      article.className = "note";
      article.id = `text-${id}`;
      article.hidden = true;
      this.reading.append(article);
    }
    this.articles.delete(id);
    this.articles.set(id, article);
    return article;
  }

  private trimArticles(visible: Set<string>): void {
    const inactive = [...this.articles].filter(([id]) => !visible.has(id));
    let excess = inactive.length - 8;
    const selection = this.host.ownerDocument.getSelection?.();
    const focused = this.host.ownerDocument.activeElement;
    for (const [id, article] of inactive) {
      if (excess <= 0) break;
      if ((focused && article.contains(focused)) ||
          (selection?.anchorNode && article.contains(selection.anchorNode)) ||
          (selection?.focusNode && article.contains(selection.focusNode))) continue;
      this.articleRenderer.releaseArticle(article);
      article.remove();
      this.articles.delete(id);
      this.readingWindows.delete(id);
      excess--;
    }
  }

  render(s: FieldState): ReadingFrame[] {
    if (this.destroyed) return [];
    this.lastState = s;
    const frames: ReadingFrame[] = [];
    const settingsKey = JSON.stringify(s.settings);
    if (this.measuredSettings !== settingsKey) { this.heights.clear(); this.measuredSettings = settingsKey; }
    this.readingBounds = null;
    this.readingSettling = false;
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
        const article = this.articleFor(node.id),
          depth = 1 - surface,
          presentation = morph > 0.5 ? "line" : "circle";
        const contentChange = this.articleRenderer.syncArticle(article, node, hub, presentation);
        this.readingPositions.changed(node.id, presentation, contentChange === "replace");
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
            s.theme,
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
        const normal = rot(
          outwardNormal(hub, position),
          (s.camera.rotation * Math.PI) / 180,
        );
        const isLong = article.classList.contains("is-long");
        const widthPx = readingWidth(s.viewport, isLong);
        const widthStr = `${widthPx.toFixed(1)}px`;
        if (article.style.width !== widthStr) article.style.width = widthStr;
        const heightKey = JSON.stringify([node.id, presentation, widthStr]);
        let height = this.heights.get(heightKey);
        if (height === undefined) {
          const preparedHeight = this.articleRenderer.estimateArticleHeight(article, node, presentation, widthPx);
          height = article.querySelector<HTMLElement>(".note-content")!.offsetHeight || preparedHeight;
          this.heights.set(heightKey, height);
        }
        const windowGeometry = JSON.stringify([
          presentation, widthStr, s.viewport.height, s.camera.z,
          anchorPt.x, anchorPt.y, normal.x, normal.y, depth, page?.angle ?? 0,
        ]);
        const previousWindow = this.readingWindows.get(node.id);
        const held = previousWindow?.geometry === windowGeometry &&
          contentChange !== "replace" && (previousWindow.held || contentChange === "append");
        const panelHeight = held ? previousWindow.height : Math.min(
          height,
          readingHeight(s.viewport, s.camera.z, normal.y),
        );
        this.readingWindows.set(node.id, { geometry: windowGeometry, height: panelHeight, held });
        const panelHeightStr = `${panelHeight.toFixed(1)}px`;
        if (article.style.height !== panelHeightStr)
          article.style.height = panelHeightStr;
        const maxFloat = Math.max(0, height - panelHeight);
        const maxFloatStr = String(Math.round(maxFloat));
        if (article.dataset.maxFloat !== maxFloatStr)
          article.dataset.maxFloat = maxFloatStr;
        let activeFloat =
          Math.abs(i - hub.scroll) < 0.6
            ? clamp(hub.textOffset, 0, maxFloat)
            : 0;
        const content = article.querySelector<HTMLElement>(".note-content")!;
        const floatTransform = `translateY(${-activeFloat.toFixed(2)}px)`;
        if (content.style.transform !== floatTransform)
          content.style.transform = floatTransform;
        const placement = placeReading(
          anchorPt,
          normal,
          widthPx,
          panelHeight,
          s.camera.z,
        );
        const clearancePx = computeHubVerticalClearance(
          hub,
          placement,
          widthPx,
          panelHeight,
          normal,
          s.camera,
          s.viewport,
        );
        let clip = resolveReadingClip(
          normal,
          height,
          panelHeight,
          activeFloat,
          clearancePx,
        );
        applyReadingClip(article, clip);
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
        if (!inert && node.id === this.selected(hub).id) {
          const corrected = this.readingPositions.restore(article, node.id, presentation, s.camera.z, activeFloat, maxFloat);
          if (Math.abs(corrected - activeFloat) > 0.01) {
            activeFloat = corrected;
            content.style.transform = `translateY(${-activeFloat.toFixed(2)}px)`;
            clip = resolveReadingClip(normal, height, panelHeight, activeFloat, clearancePx);
            applyReadingClip(article, clip);
          }
          if (Math.abs(activeFloat - hub.textOffset) > 0.01)
            this.readingCorrections.push({ chapterId: node.id, presentation, textOffset: activeFloat });
          this.readingSettling = this.readingPositions.isSettling(node.id, presentation);
          this.readingPositions.capture(article, node.id, presentation, s.camera.z,
            JSON.stringify([widthStr, panelHeight, activeFloat, this.articleRenderer.fontVersion]));
        }
        frames.push({
          id: `reading:${node.id}`,
          chapterId: node.id,
          hubId: hub.id,
          presentation,
          visible: true,
          inert,
          left: targetLeft,
          top: targetTop,
          width: widthPx * s.camera.z,
          height: panelHeight * s.camera.z,
          scale: s.camera.z,
          opacity: surface ** 1.2,
          blur: s.settings.reducedMotion ? 0 : blur,
          rotationY: turnY,
          transformOrigin: {
            x: placement.originX,
            y: placement.originY,
          },
          anchorY: placement.originY,
          side: placement.side,
          clipEdge: clip.edge,
          maskImage: clip.maskImage,
          textOffset: activeFloat,
          maxFloat,
          pointerEvents: inert ? "none" : "auto",
        });
      });
    for (const [id, article] of this.articles)
      if (!visible.has(id)) {
        if (!article.hidden) article.hidden = true;
        if (!article.inert) article.inert = true;
        if (article.getAttribute("aria-hidden") !== "true")
          article.setAttribute("aria-hidden", "true");
      }
    this.trimArticles(visible);
    return frames;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const article of this.articles.values()) this.articleRenderer.releaseArticle(article);
    this.articles.clear();
    this.reading.replaceChildren();
    this.contentProbe = null;
    this.readingWindows.clear();
    this.readingPositions.clear();
    this.readingCorrections = [];
    this.heights.clear();
    this.lastState = null;
    this.readingBounds = null;
    this.readingSettling = false;
  }
}
