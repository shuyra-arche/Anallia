import type { Vec } from "./types.ts";

/**
 * Section 4 — Unified 24×24 SVG Geometric Icon System & Optical Calibration Tokens.
 * Every operational glyph shares a 24×24 design grid, 20×20px nominal screen size,
 * 1.8px base stroke weight, round caps/joins, and explicit optical compensation tokens.
 */
export interface IconShape {
  tag: "path" | "circle" | "line";
  attrs: Record<string, string | number>;
}

export interface IconToken {
  id: string;
  glyph: string;
  label: string;
  viewBox: string;
  sizePx: number;
  baseStrokeWidth: number;
  /** Optical scale factor around (12, 12) so visual weight matches across shapes. */
  opticalScale: number;
  /** Optical center-of-mass offset in 24×24 grid units. */
  opticalOffset: Vec;
  /** Stroke width delta added to baseStrokeWidth for dense vs sparse paths. */
  strokeCompensation: number;
  shapes: readonly IconShape[];
}

export const ICON_TOKENS: Readonly<Record<string, IconToken>> = {
  "⊙": {
    id: "overview",
    glyph: "⊙",
    label: "全域观察",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 1.04,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: 0,
    shapes: [
      { tag: "circle", attrs: { cx: 12, cy: 12, r: 8.1 } },
      { tag: "circle", attrs: { cx: 12, cy: 12, r: 1.85, fill: "currentColor", stroke: "none" } },
    ],
  },
  "⌕": {
    id: "search",
    glyph: "⌕",
    label: "检索",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 1.02,
    opticalOffset: { x: -0.35, y: -0.35 },
    strokeCompensation: 0.05,
    shapes: [
      { tag: "circle", attrs: { cx: 10.6, cy: 10.6, r: 6.1 } },
      { tag: "path", attrs: { d: "M15.1 15.1L19.6 19.6" } },
    ],
  },
  "↶": {
    id: "back",
    glyph: "↶",
    label: "历史返回",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 1.02,
    opticalOffset: { x: 0.15, y: 0.1 },
    strokeCompensation: 0.05,
    shapes: [
      { tag: "path", attrs: { d: "M8.2 7.2L4.6 10.8L8.2 14.4" } },
      { tag: "path", attrs: { d: "M5.2 10.8H13.2C16.6 10.8 19.2 13.3 19.2 16.5C19.2 17.6 18.9 18.6 18.3 19.4" } },
    ],
  },
  "⚙": {
    id: "settings",
    glyph: "⚙",
    label: "设置",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 0.98,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: -0.08,
    shapes: [
      { tag: "circle", attrs: { cx: 12, cy: 12, r: 3.1 } },
      { tag: "circle", attrs: { cx: 12, cy: 12, r: 6.4 } },
      {
        tag: "path",
        attrs: {
          d: "M12 3.2V5.4M12 18.6V20.8M3.2 12H5.4M18.6 12H20.8M5.78 5.78L7.34 7.34M16.66 16.66L18.22 18.22M18.22 5.78L16.66 7.34M7.34 16.66L5.78 18.22",
        },
      },
    ],
  },
  "◌": {
    id: "loading",
    glyph: "◌",
    label: "加载动效",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 1.03,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: 0,
    shapes: [
      { tag: "path", attrs: { d: "M12 3.8A8.2 8.2 0 0 1 19.8 9.5" } },
      { tag: "path", attrs: { d: "M19.5 15.2A8.2 8.2 0 0 1 8.8 19.6" } },
      { tag: "path", attrs: { d: "M5.1 16.4A8.2 8.2 0 0 1 7.6 5.1" } },
      { tag: "circle", attrs: { cx: 12, cy: 12, r: 2.3 } },
    ],
  },
  "↑": {
    id: "up",
    glyph: "↑",
    label: "返回上级",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 1.0,
    opticalOffset: { x: 0, y: -0.2 },
    strokeCompensation: 0.05,
    shapes: [
      { tag: "path", attrs: { d: "M12 19.2V5.2" } },
      { tag: "path", attrs: { d: "M6.8 10.4L12 5.2L17.2 10.4" } },
    ],
  },
  "⌖": {
    id: "refocus",
    glyph: "⌖",
    label: "回到焦点",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 1.02,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: -0.04,
    shapes: [
      { tag: "circle", attrs: { cx: 12, cy: 12, r: 6.4 } },
      { tag: "path", attrs: { d: "M12 2.8V6.2M12 17.8V21.2M2.8 12H6.2M17.8 12H21.2" } },
      { tag: "circle", attrs: { cx: 12, cy: 12, r: 1.4, fill: "currentColor", stroke: "none" } },
    ],
  },
  "✓": {
    id: "confirm",
    glyph: "✓",
    label: "确认",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 1.02,
    opticalOffset: { x: 0, y: 0.2 },
    strokeCompensation: 0.12,
    shapes: [
      { tag: "path", attrs: { d: "M5.2 12.6L9.8 17.2L18.8 7.4" } },
    ],
  },
  "✕": {
    id: "cancel",
    glyph: "✕",
    label: "取消",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 1.8,
    opticalScale: 0.96,
    opticalOffset: { x: 0, y: 0 },
    strokeCompensation: 0.08,
    shapes: [
      { tag: "path", attrs: { d: "M6.6 6.6L17.4 17.4M17.4 6.6L6.6 17.4" } },
    ],
  },
};

export function resolveIconToken(glyph: string): IconToken | undefined {
  return ICON_TOKENS[glyph];
}

export type LabelContentKind = "icon" | "symbol" | "text";

export function classifyLabelContent(glyph: string): LabelContentKind {
  if (glyph in ICON_TOKENS) return "icon";
  if (glyph.length <= 3) return "symbol";
  return "text";
}
