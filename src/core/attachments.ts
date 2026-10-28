import type { Command } from "./types.ts";
import type { IconToken, LabelContentKind } from "./icons.ts";
import type { SymbolGeometry, SymbolKind } from "./symbol-morph.ts";

/** Semantic attachment contracts. An operation's scope is independent of the
 * hub that currently hosts its visual anchor. The anchor ID survives a change
 * of camera, hub form, and host projection. */
export type AttachmentScope = "global" | "hub" | "chapter";
export type AttachmentRole = "ordinary" | "local" | "operation" | "background";
export type AttachmentSide = "content" | "opposite";

export interface SemanticAnchor {
  /** Stable within the element's semantic identity; never a screen coordinate. */
  id: string;
  hostHub: string;
  /** Material parameter on the hub's generalized circle. */
  parameter: number;
}

export interface FieldAttachment {
  id: string;
  glyph: string;
  aria: string;
  scope: AttachmentScope;
  role: AttachmentRole;
  anchor: SemanticAnchor;
  side: AttachmentSide;
  /** Distance along the material normal, in world units before camera projection. */
  distance: number;
  opacity: number;
  command: Command;
  visual: "current" | "peer" | "nav" | "background";
  contentKind?: LabelContentKind;
  icon?: IconToken;
  symbolKind?: SymbolKind;
  symbolMorph?: number;
  symbolGeometry?: SymbolGeometry;
}

/** Declarative global actions; the renderer does not hardcode q0 / s0. */
export interface GlobalOperation {
  id: string;
  glyph: string;
  aria: string;
  arc: number;
  symbolKind?: SymbolKind;
  action: { kind: "command"; command: Command } | { kind: "hub-glyph"; glyph: string };
}
export const GLOBAL_OPERATIONS: readonly GlobalOperation[] = [
  { id: "overview", glyph: "⊙", aria: "全域观察", arc: -96, symbolKind: "overview",
    action: { kind: "command", command: { type: "overview" } } },
  { id: "search", glyph: "⌕", aria: "检索枢", arc: -48, symbolKind: "search",
    action: { kind: "hub-glyph", glyph: "⌕" } },
  { id: "settings", glyph: "⚙", aria: "设置枢", arc: 0, symbolKind: "settings",
    action: { kind: "hub-glyph", glyph: "⚙" } },
  { id: "loading", glyph: "◌", aria: "播放 Loading V24 动效", arc: 48,
    action: { kind: "command", command: { type: "loading" } } },
  { id: "back", glyph: "↶", aria: "历史返回", arc: 96, symbolKind: "history",
    action: { kind: "command", command: { type: "back" } } },
];

export function resolveGlobalCommand(
  operation: GlobalOperation,
  hubRootByGlyph: ReadonlyMap<string, string>,
): Command {
  if (operation.action.kind === "command") return operation.action.command;
  const target = hubRootByGlyph.get(operation.action.glyph);
  if (!target) throw new Error(`Missing global operation hub: ${operation.action.glyph}`);
  return { type: "navigate", target };
}
