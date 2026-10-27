import type { Chapter, Hub } from "../core/types.ts";
function appendFormattedText(target: HTMLElement, source: string) {
  let cursor = 0;
  for (const match of source.matchAll(/\{([^{}|]+)\|([^{}]+)\}/g)) {
    target.append(document.createTextNode(source.slice(cursor, match.index)));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inline-ref";
    button.dataset.target = match[2];
    button.textContent = match[2].startsWith("act:")
      ? match[1]
      : `${match[1]} ↗`;
    target.append(button);
    cursor = match.index! + match[0].length;
  }
  target.append(document.createTextNode(source.slice(cursor)));
}
function buildHorizontalList(items: string[]): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.className = "shuyra-list is-horizontal";
  for (const raw of items) {
    const text = raw.trim();
    if (!text) continue;
    const li = document.createElement("li");
    li.className = "shuyra-list-item";
    appendFormattedText(li, text);
    ul.append(li);
  }
  return ul;
}
function buildVerticalList(lines: string[]): HTMLUListElement {
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
        valBox.append(buildHorizontalList(valText.split(" | ")));
      } else {
        appendFormattedText(valBox, valText);
      }
      li.append(keySpan, valBox);
    } else {
      appendFormattedText(li, line);
    }
    ul.append(li);
  }
  return ul;
}
export function fillArticle(
  article: HTMLElement,
  node: Chapter,
  hub: Hub,
  presentation: "circle" | "line",
  searchRoot?: string,
) {
  article.replaceChildren();
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `${hub.glyph} / ${node.name} · DEPTH ${String(hub.path.length - 1).padStart(2, "0")}`;
  const heading = document.createElement("h2");
  heading.textContent = node.title;
  article.append(eyebrow, heading);
  if (node.id === searchRoot) {
    const box = document.createElement("div");
    box.className = "hub-search-box";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "hub-search-input";
    input.placeholder = "键入关键词（如：流场、圆心、反演、列表、长文）…";
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
  article.classList.toggle("is-long", blocks.length > 1 || source.length > 220);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.startsWith("[vlist]")) {
      const lines = trimmed.replace(/^\[vlist\]\s*/, "").split(/\n+/);
      article.append(buildVerticalList(lines));
    } else if (trimmed.startsWith("[hlist]")) {
      const content = trimmed.replace(/^\[hlist\]\s*/, "");
      const items = content.includes(" | ")
        ? content.split(" | ")
        : content.split(/\n+/);
      article.append(buildHorizontalList(items));
    } else {
      const paragraph = document.createElement("p");
      appendFormattedText(paragraph, trimmed);
      article.append(paragraph);
    }
  }
  const tail = document.createElement("div");
  tail.className = "tail";
  tail.textContent = `${node.name} · ${presentation === "circle" ? "RADIAL TO CENTER" : "LINEAR SPINE"}`;
  article.append(tail);
  article.dataset.presentation = presentation;
}
