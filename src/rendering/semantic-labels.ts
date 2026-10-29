import type { LabelFrame } from "../core/graphics.ts";
import { svg } from "./dom.ts";
import { populateIconGlyph } from "./svg-symbols.ts";

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
}

/** Keyboard and accessibility proxies; geometry and commands arrive in the frame. */
export class SemanticLabels {
  private readonly entries = new Map<string, Label>();
  private readonly labels: SVGGElement;
  constructor(labels: SVGGElement) {
    this.labels = labels;
  }

  render(frames: readonly LabelFrame[]): void {
    for (const entry of this.entries.values())
      entry.group.style.display = "none";
    for (const frame of frames) this.update(frame);
  }

  private update(frame: LabelFrame): void {
    const { id, attachment, page, aria, opacity: alpha } = frame;
    const name = frame.glyph,
      kind = frame.visual;
    const anchor = frame.layout.hinge,
      degree = frame.layout.degree;
    const pool = this.entries;
    let entry = pool.get(id);
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
      };
      pool.set(id, entry);
    }
    const e = entry;
    const interactive = frame.interactive;
    e.group.style.display = "";
    e.group.style.opacity = alpha < 0.999 ? String(alpha) : "";
    const zoom = frame.layout.scale;
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
    if (frame.localScrollHub)
      e.group.dataset.localScroll = frame.localScrollHub;
    else delete e.group.dataset.localScroll;
    e.group.classList.toggle("is-current", kind === "current");
    e.group.setAttribute("aria-label", aria);

    const { x: deltaX, y: deltaY } = frame.layout.offset;
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
    // Label geometry stays local; the parent scales typography, icons and hit targets together.
    const labelTransform = `translate(${deltaX} ${deltaY}) rotate(${degree})`;
    e.ring.setAttribute("cx", "0");
    e.ring.setAttribute("cy", "0");
    e.ring.setAttribute("transform", labelTransform);

    const symbolKind = frame.symbolKind;
    const iconToken = frame.icon;
    const contentKind = frame.contentKind;
    e.group.dataset.contentKind = contentKind;
    e.group.classList.toggle("has-icon", Boolean(symbolKind || iconToken));

    if (iconToken) {
      if (symbolKind) e.group.dataset.symbolKind = symbolKind;
      else delete e.group.dataset.symbolKind;
      const fb = frame.interaction;
      e.group.classList.toggle("is-hovered", Boolean(fb?.hover));
      e.group.classList.toggle("is-pressed", Boolean(fb?.press));
      e.group.classList.toggle("is-focused", Boolean(fb?.focus));
      e.group.classList.toggle(
        "is-active-symbol",
        Boolean(symbolKind && (frame.symbolActivity ?? 0) >= 0.35),
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
      if (e.text.textContent !== name) e.text.textContent = name;
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
      if (e.text.textContent !== name) e.text.textContent = name;
      e.text.setAttribute("transform", labelTransform);
    }

    const width = frame.layout.width;
    e.hit.setAttribute("x", String(-width / 2));
    e.hit.setAttribute("y", "-22");
    e.hit.setAttribute("width", String(width));
    e.hit.setAttribute("transform", labelTransform);

    e.group.classList.toggle("is-resonating-ref", Boolean(frame.resonating));
    if (frame.localPhase) e.group.dataset.localPhase = frame.localPhase;
    else delete e.group.dataset.localPhase;
  }

  destroy(): void {
    this.entries.clear();
    this.labels.replaceChildren();
  }
}
