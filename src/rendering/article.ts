import type { Chapter, Hub } from "../core/types.ts";
import { resolveIconToken } from "../core/icons.ts";
import type { IconToken } from "../core/icons.ts";
import { Catalog } from "../content/catalog.ts";
interface ArticleVisuals {
  inlineIcon(token: IconToken, morph: number): SVGSVGElement;
  iconShowcase(hub: Hub): HTMLElement;
}
export class ArticleRenderer {
  private readonly catalog: Catalog;
  private readonly visuals: ArticleVisuals;
  constructor(catalog: Catalog, visuals: ArticleVisuals) {
    this.catalog = catalog;
    this.visuals = visuals;
  }
  private appendFormattedText(
    target: HTMLElement,
    source: string,
    hubMorph = 0,
  ) {
    let cursor = 0;
    for (const match of source.matchAll(/\{([^{}|]+)\|([^{}]+)\}/g)) {
      target.append(document.createTextNode(source.slice(cursor, match.index)));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inline-ref";
      button.dataset.target = match[2];
      const rawLabel = match[1].trim();
      const firstChar = Array.from(rawLabel)[0] ?? "";
      const iconToken = resolveIconToken(firstChar);
      if (iconToken) {
        button.classList.add("has-inline-icon");
        button.append(this.visuals.inlineIcon(iconToken, hubMorph));
        const rest = rawLabel.slice(firstChar.length).trim();
        const suffix = match[2].startsWith("act:") ? "" : " ↗";
        button.append(
          document.createTextNode(
            rest ? ` ${rest}${suffix}` : `${firstChar}${suffix}`,
          ),
        );
      } else {
        button.textContent = match[2].startsWith("act:")
          ? match[1]
          : `${match[1]} ↗`;
      }
      target.append(button);
      cursor = match.index! + match[0].length;
    }
    target.append(document.createTextNode(source.slice(cursor)));
  }
  private buildHorizontalList(items: string[], hubMorph = 0): HTMLUListElement {
    const ul = document.createElement("ul");
    ul.className = "shuyra-list is-horizontal";
    for (const raw of items) {
      const text = raw.trim();
      if (!text) continue;
      const li = document.createElement("li");
      li.className = "shuyra-list-item";
      this.appendFormattedText(li, text, hubMorph);
      ul.append(li);
    }
    return ul;
  }
  private buildVerticalList(lines: string[], hubMorph = 0): HTMLUListElement {
    const ul = document.createElement("ul");
    ul.className = "shuyra-list is-vertical";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const li = document.createElement("li");
      li.className = "shuyra-list-item";
      const sepIndex = line.indexOf("::");
      if (sepIndex !== -1) {
        const keyText = line.slice(0, sepIndex).trim();
        const valText = line.slice(sepIndex + 2).trim();
        const keySpan = document.createElement("span");
        keySpan.className = "list-key";
        keySpan.textContent = keyText;
        const valBox = document.createElement("div");
        valBox.className = "list-val";
        if (valText.includes(" | ")) {
          valBox.classList.add("is-options");
          valBox.append(
            this.buildHorizontalList(valText.split(" | "), hubMorph),
          );
        } else {
          valBox.classList.add("is-prose");
          this.appendFormattedText(valBox, valText, hubMorph);
        }
        li.append(keySpan, valBox);
      } else {
        li.classList.add("is-plain-item");
        this.appendFormattedText(li, line, hubMorph);
      }
      ul.append(li);
    }
    return ul;
  }
  fillArticle(
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
    article.append(eyebrow, heading);
    if (node.id === this.catalog.searchRoot) {
      const box = document.createElement("div");
      box.className = "hub-search-box";
      const input = document.createElement("input");
      input.type = "search";
      input.className = "hub-search-input";
      input.placeholder =
        "键入关键词（如：流场、轴旋、深空、反演、列表、长文）…";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "检索章节并实时生成本枢周界标签");
      const status = document.createElement("div");
      status.className = "search-status";
      box.append(input, status);
      article.append(box);
    }
    const source = node.expressions[presentation],
      blocks = source.split(/\n\n+/);
    article.classList.toggle(
      "is-long",
      blocks.length > 1 || source.length > 220,
    );
    for (const block of blocks) {
      const trimmed = block.trim();
      if (trimmed === "[icons]") {
        article.append(this.visuals.iconShowcase(hub));
      } else if (trimmed.startsWith("[vlist]")) {
        const lines = trimmed.replace(/^\[vlist\]\s*/, "").split(/\n+/);
        article.append(this.buildVerticalList(lines, hub.morph));
      } else if (trimmed.startsWith("[hlist]")) {
        const content = trimmed.replace(/^\[hlist\]\s*/, "");
        const items = content.includes(" | ")
          ? content.split(" | ")
          : content.split(/\n+/);
        article.append(this.buildHorizontalList(items, hub.morph));
      } else {
        const paragraph = document.createElement("p");
        this.appendFormattedText(paragraph, trimmed, hub.morph);
        article.append(paragraph);
      }
    }
    const tail = document.createElement("div");
    tail.className = "tail";
    tail.textContent = `${node.name} · ${presentation === "circle" ? "RADIAL TO CENTER" : "LINEAR SPINE"}`;
    article.append(tail);
    const content = document.createElement("div");
    content.className = "note-content";
    content.append(...Array.from(article.childNodes));
    const window = document.createElement("div");
    window.className = "note-window";
    window.append(content);
    article.append(window);
    article.dataset.presentation = presentation;
  }
}
