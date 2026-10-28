/*! Lucide 1.17.0; selected icon geometry.
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
import type { Vec } from "./types.ts";
export interface IconShape {
  tag: "path" | "circle" | "line";
  attrs: Record<string, string | number>;
}
export interface IconToken {
  id: string;
  glyph: string;
  label: string;
  iconName: string;
  viewBox: string;
  sizePx: number;
  baseStrokeWidth: number;
  opticalScale: number;
  opticalOffset: Vec;
  strokeCompensation: number;
  shapes: readonly IconShape[];
}
export const ICON_TOKENS: Readonly<Record<string, IconToken>> = {
  "⊙": {
    id: "overview",
    glyph: "⊙",
    label: "全域观察",
    iconName: "circle-dot",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "circle",
        attrs: {
          cx: "12",
          cy: "12",
          r: "10",
        },
      },
      {
        tag: "circle",
        attrs: {
          cx: "12",
          cy: "12",
          r: "1",
        },
      },
    ],
  },
  "⌕": {
    id: "search",
    glyph: "⌕",
    label: "检索",
    iconName: "search",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "m21 21-4.34-4.34",
        },
      },
      {
        tag: "circle",
        attrs: {
          cx: "11",
          cy: "11",
          r: "8",
        },
      },
    ],
  },
  "⚙": {
    id: "settings",
    glyph: "⚙",
    label: "设置",
    iconName: "settings",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
        },
      },
      {
        tag: "circle",
        attrs: {
          cx: "12",
          cy: "12",
          r: "3",
        },
      },
    ],
  },
  "↶": {
    id: "back",
    glyph: "↶",
    label: "历史返回",
    iconName: "corner-up-left",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "M20 20v-7a4 4 0 0 0-4-4H4",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M9 14 4 9l5-5",
        },
      },
    ],
  },
  "◌": {
    id: "loading",
    glyph: "◌",
    label: "加载动效",
    iconName: "loader-circle",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "M21 12a9 9 0 1 1-6.219-8.56",
        },
      },
    ],
  },
  "↑": {
    id: "up",
    glyph: "↑",
    label: "返回上级",
    iconName: "corner-left-up",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "M14 9 9 4 4 9",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M20 20h-7a4 4 0 0 1-4-4V4",
        },
      },
    ],
  },
  "⌖": {
    id: "refocus",
    glyph: "⌖",
    label: "回到焦点",
    iconName: "scan",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "M3 7V5a2 2 0 0 1 2-2h2",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M17 3h2a2 2 0 0 1 2 2v2",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M21 17v2a2 2 0 0 1-2 2h-2",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M7 21H5a2 2 0 0 1-2-2v-2",
        },
      },
    ],
  },
  "✓": {
    id: "confirm",
    glyph: "✓",
    label: "确认",
    iconName: "check",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "M20 6 9 17l-5-5",
        },
      },
    ],
  },
  "✕": {
    id: "cancel",
    glyph: "✕",
    label: "取消",
    iconName: "x",
    viewBox: "0 0 24 24",
    sizePx: 20,
    baseStrokeWidth: 2,
    opticalScale: 1,
    opticalOffset: {
      x: 0,
      y: 0,
    },
    strokeCompensation: 0,
    shapes: [
      {
        tag: "path",
        attrs: {
          d: "M18 6 6 18",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "m6 6 12 12",
        },
      },
    ],
  },
};
export function resolveIconToken(glyph: string): IconToken | undefined {
  return ICON_TOKENS[glyph];
}
export type LabelContentKind = "icon" | "symbol" | "text";
export function classifyLabelContent(glyph: string): LabelContentKind {
  if (glyph in ICON_TOKENS) return "icon";
  return glyph.length <= 3 ? "symbol" : "text";
}
