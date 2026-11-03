import type { Catalog } from "../content/catalog.ts";
import type { FieldState } from "../core/types.ts";
export function tideLocalWindow(state: Readonly<FieldState>, catalog: Catalog) {
  const hub = state.hubs[state.focus],
    chapter = catalog.get(hub.path.at(-1)!);
  const siblings = catalog.siblings(chapter.id, state.searchResults),
    index = siblings.findIndex((c) => c.id === chapter.id);
  const items = [
    ...(chapter.parent
      ? [{ target: chapter.parent, prefix: "↑", title: "上一层" }]
      : []),
    ...(index > 0
      ? [{ target: siblings[index - 1].id, prefix: "‹", title: "上一节" }]
      : []),
    ...chapter.children.map((target) => ({
      target,
      prefix: "↓",
      title: "子章节",
    })),
    ...(index < siblings.length - 1
      ? [{ target: siblings[index + 1].id, prefix: "›", title: "下一节" }]
      : []),
  ];
  const slots = Math.max(4, Math.floor((state.viewport.height - 122) / 52));
  const capacity = Math.max(1, Math.min(4, slots - 3));
  const paged = items.length > Math.max(1, slots - 1) || items.length > 4;
  const count = paged ? capacity : items.length;
  const maxScroll = Math.max(0, items.length - count);
  const start = Math.min(maxScroll, Math.max(0, Math.round(hub.localScroll)));
  return {
    items,
    visible: items.slice(start, start + count),
    start,
    count,
    paged,
    maxScroll,
  };
}
