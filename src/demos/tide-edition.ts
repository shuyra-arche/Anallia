import type { ReaderDefinition } from "../core/content.ts";
import { hubInk } from "../core/palette.ts";
import type { ReaderHandle } from "../core/reader.ts";
import { tideLenses } from "./tide-hub.ts";

/** Passive publication identity. All actions belong to hub labels or the upper tools. */
export function mountTideEdition(
  host: HTMLElement,
  reader: ReaderHandle,
  definition: ReaderDefinition,
): () => void {
  host.classList.add("tide-edition");
  const edition = host.ownerDocument.createElement("header");
  edition.className = "tide-masthead";
  const brand = host.ownerDocument.createElement("span"),
    lens = host.ownerDocument.createElement("span");
  brand.className = "tide-logotype";
  brand.textContent = "ANALLIA";
  lens.className = "tide-series";
  edition.append(brand, lens);
  host.append(edition);
  const unsubscribe = reader.subscribe((state) => {
    if (state.status !== "active") return;
    const pair = tideLenses[state.location.hub]?.[state.location.presentation];
    lens.textContent =
      state.view === "overview"
        ? "点枢进入 · 拖动空间"
        : pair
          ? `${state.location.presentation === "circle" ? "并置" : "顺读"} · ${pair[0]} · 点枢换形`
          : "检索与偏好";
    lens.title = pair?.[1] ?? "";
    lens.setAttribute(
      "aria-label",
      pair
        ? `${lens.textContent}。${pair[1]} 点章节阅读，点当前锚点切换形态。`
        : lens.textContent,
    );
  });
  const updateReferences = () => {
    for (const link of host.querySelectorAll<HTMLElement>(
      ".inline-ref[data-target]",
    )) {
      const chapter = definition.manifest.chapters.find(
        (row) => row.id === link.dataset.target,
      );
      const hub = definition.manifest.definitions.find(
        (hub) => hub.id === chapter?.hub,
      );
      if (hub) {
        link.style.setProperty(
          "--tide-reference-light",
          hubInk(hub.theme, "light"),
        );
        link.style.setProperty(
          "--tide-reference-dark",
          hubInk(hub.theme, "dark"),
        );
      }
    }
  };
  const observer = new MutationObserver(updateReferences);
  observer.observe(host, { childList: true, subtree: true });
  updateReferences();
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    observer.disconnect();
    edition.remove();
    host.classList.remove("tide-edition");
    stopDestroy();
  };
  const stopDestroy = reader.subscribe((state) => {
    if (state.status === "destroyed") destroy();
  });
  return destroy;
}
