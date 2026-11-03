import { clamp } from "../core/math.ts";
import type { ContentDocument, Presentation } from "../core/content.ts";
import { presentationAnchor } from "../core/reading-continuity.ts";
import type { ReadingClipSpec } from "../core/layout.ts";
import { captureReadingAnchor, rangeAtSource, sourceRangeRect } from "./reading-anchor.ts";

export interface ReadingPosition {
  chapterId: string;
  presentation: "circle" | "line";
  source: number;
  offset: number;
}
export interface ReadingCorrection {
  chapterId: string;
  presentation: "circle" | "line";
  textOffset?: number;
  readingRows?: number;
}
interface SavedPosition { value: ReadingPosition; signature: string; document?: ContentDocument; alignment?: "window" }

/** Source positions contain no DOM references and survive article cache eviction. */
export class ReadingPositions {
  private readonly saved = new Map<string, SavedPosition>();
  private readonly pending = new Map<string, { stable: number; lastOffset: number | null }>();
  private key(id: string, presentation: "circle" | "line") { return `${id}:${presentation}`; }
  get(id: string, presentation: "circle" | "line"): ReadingPosition | null {
    return this.saved.get(this.key(id, presentation))?.value ?? null;
  }
  seek(id: string, presentation: "circle" | "line", source: number, document?: ContentDocument, anchorOffset = 0, alignment?: "window"): void {
    const key = this.key(id, presentation);
    this.saved.set(key, { signature: "", document, alignment, value: { chapterId: id, presentation, source, offset: anchorOffset } });
    this.pending.set(key, { stable: 0, lastOffset: null });
  }
  transfer(id: string, from: Presentation, to: Presentation, target: ContentDocument) {
    const bookmark = (presentation: Presentation) => {
      const saved = this.saved.get(this.key(id, presentation));
      return saved?.document ? { document: saved.document, source: saved.value.source } : null;
    };
    const anchor = presentationAnchor(bookmark(from), bookmark(to), target);
    // Preserve the glyph's place in the reading window. The actual scroll offset
    // is recomputed from its target DOM range, never copied from the source hub.
    const position = this.saved.get(this.key(id, anchor.reason === "matched" ? from : to));
    this.seek(id, to, anchor.source, target, anchor.reason === "start" ? 0 : position?.value.offset ?? 0);
    return anchor;
  }
  saveSource(id: string, presentation: Presentation, source: number, document: ContentDocument): void {
    this.saved.set(this.key(id, presentation), { signature: "", document,
      value: { chapterId: id, presentation, source, offset: 0 } });
  }
  settleSource(id: string, presentation: Presentation): void { this.pending.delete(this.key(id, presentation)); }
  invalidate(): void { for (const key of this.saved.keys()) this.pending.set(key, { stable: 0, lastOffset: null }); }
  isSettling(id: string, presentation: "circle" | "line"): boolean { return this.pending.has(this.key(id, presentation)); }
  changed(id: string, presentation: "circle" | "line", replacement: boolean): void {
    if (replacement && this.saved.has(this.key(id, presentation))) this.pending.set(this.key(id, presentation), { stable: 0, lastOffset: null });
  }
  restore(article: HTMLElement, id: string, presentation: "circle" | "line", scale: number, offset: number, maxOffset: number): number {
    const key = this.key(id, presentation);
    const pending = this.pending.get(key);
    if (!pending) return offset;
    const saved = this.saved.get(key);
    if (!saved || !(scale > 0) || (pending.lastOffset !== null && Math.abs(offset - pending.lastOffset) > 0.1)) {
      this.pending.delete(key);
      return offset;
    }
    if (saved.value.source === 0) {
      this.pending.delete(key);
      saved.signature = "";
      return 0;
    }
    const located = rangeAtSource(article, saved.value.source);
    if (!located) {
      saved.value = { ...saved.value, source: 0, offset: 0 };
      saved.signature = "";
      this.pending.delete(key);
      return 0;
    }
    // A portable session anchor aligns with the current visible reading window.
    // Re-evaluate after each correction because the clip itself can change with scroll.
    const window = saved.alignment === "window" ? article.querySelector<HTMLElement>(".note-window") : null;
    const top = window ? Math.max(0, window.getBoundingClientRect().top) + 3
      : article.getBoundingClientRect().top + saved.value.offset * scale;
    const delta = (sourceRangeRect(located.range).top - top) / scale;
    const next = clamp(offset + delta, 0, maxOffset);
    pending.stable = Math.abs(next - offset) < 0.1 ? pending.stable + 1 : 0;
    pending.lastOffset = next;
    if (pending.stable >= 2) this.pending.delete(key);
    saved.signature = "";
    return next;
  }
  capture(article: HTMLElement, id: string, presentation: "circle" | "line", scale: number, signature: string, document?: ContentDocument): void {
    const key = this.key(id, presentation);
    if ((this.pending.has(key) && this.saved.has(key)) || this.saved.get(key)?.signature === signature || !(scale > 0)) return;
    const anchor = captureReadingAnchor(article, { selection: false });
    if (!anchor) return;
    const offset = (anchor.top - article.getBoundingClientRect().top) / scale;
    this.saved.set(key, { signature, document, value: { chapterId: id, presentation, source: anchor.source, offset } });
  }
  clear(): void { this.saved.clear(); this.pending.clear(); }
}

export function applyReadingClip(article: HTMLElement, clip: ReadingClipSpec): void {
  const windowEl = article.querySelector<HTMLElement>(".note-window")!;
  if (article.dataset.clipEdge !== clip.edge) article.dataset.clipEdge = clip.edge;
  const fade = clip.fadePx > 0.5 ? clip.edge : "none";
  if (windowEl.dataset.clipFade !== fade) windowEl.dataset.clipFade = fade;
  for (const [property, value] of [["marginTop", clip.windowMarginTop], ["paddingTop", clip.windowPaddingTop], ["height", clip.windowHeight]] as const) {
    const next = `${value.toFixed(1)}px`;
    if (windowEl.style[property] !== next) windowEl.style[property] = next;
  }
  if (windowEl.dataset.maskSpec !== clip.maskImage) {
    windowEl.dataset.maskSpec = clip.maskImage;
    windowEl.style.maskImage = clip.maskImage;
    windowEl.style.webkitMaskImage = clip.maskImage;
  }
}
