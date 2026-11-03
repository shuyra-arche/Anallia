import type { Catalog } from "../content/catalog.ts";
import type { FieldState } from "../core/types.ts";

/** A projection of Field, never a second navigation state or history owner. */
export type ReaderLocation =
  | { kind: "loading" }
  | { kind: "overview"; hub: string; title: string; destinations: { hub: string; glyph: string; title: string }[] }
  | {
      kind: "reading";
      hub: string;
      chapter: string;
      anchor: string;
      title: string;
      trail: string;
      position: number;
      total: number;
      parent: string | null;
      child: string | null;
      shape: "circle" | "line";
    };

export type ReaderMotion =
  | { kind: "idle" }
  | { kind: "morph"; to: "circle" | "line" }
  | { kind: "level" }
  | { kind: "passage" };

export function readerLocation(state: FieldState, catalog: Catalog): ReaderLocation {
  if (state.loading) return { kind: "loading" };
  const hub = state.hubs[state.focus];
  const chapter = catalog.get(hub.path.at(-1)!);
  if (state.overview) return {
    kind: "overview", hub: hub.id, title: chapter.title,
    destinations: catalog.definitions
      .filter(item => item.kind !== "search" && item.kind !== "settings")
      .map(item => ({ hub: item.id, glyph: item.glyph, title: catalog.get(item.root).title })),
  };
  const siblings = catalog.siblings(chapter.id, state.searchResults);
  return {
    kind: "reading", hub: hub.id, chapter: chapter.id, anchor: chapter.name, title: chapter.title,
    trail: `${hub.glyph} 枢 · ${chapter.parent ? catalog.get(chapter.parent).title : "起点"}`,
    position: Math.max(0, siblings.findIndex(node => node.id === chapter.id)),
    total: siblings.length, parent: chapter.parent, child: chapter.children[0] ?? null,
    shape: hub.targetMorph > 0.5 ? "line" : "circle",
  };
}

export function readerMotion(state: FieldState): ReaderMotion {
  switch (state.transition.kind) {
    case "passage": return { kind: "passage" };
    case "content": return { kind: "level" };
    case "morph": return { kind: "morph", to: state.transition.value.to > 0.5 ? "line" : "circle" };
    case "idle": return { kind: "idle" };
  }
}

export function readerHint(location: ReaderLocation, motion: ReaderMotion): string {
  switch (motion.kind) {
    case "morph": return motion.to === "line" ? "正在展开为线 · 仍在当前章节" : "正在收拢为圆 · 仍在当前章节";
    case "level": return "正在翻页 · 前往另一层章节";
    case "passage": return "正在前往关联枢";
  }
  switch (location.kind) {
    case "loading": return "正在准备篇章…";
    case "overview": return "选择一枚枢，进入它的篇章；也可以回到刚才的阅读。";
    case "reading": return location.total > 1
      ? "空白处滚动 / ← → 切换同级 · 正文内滚动阅读"
      : location.child ? "从「进入下一层」开始 · 圆与线是同一枢的两种形态" : "正文内滚动阅读 · 返回回到上一处访问";
  }
}
