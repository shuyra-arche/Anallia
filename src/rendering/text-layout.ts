import {
  clearCache as clearPretextCache,
  layout as layoutPrepared,
  prepare,
  type PreparedText,
} from "@chenglou/pretext";

export interface TextStyle {
  font: string;
  lineHeight: number;
  letterSpacing?: number;
  whiteSpace?: "normal" | "pre-wrap";
  wordBreak?: "normal" | "keep-all";
}

export interface ParagraphLayoutRequest {
  contentVersion: string | number;
  stable?: boolean;
  domHeight?: number;
}

export interface ParagraphLayout {
  height: number;
  lineCount: number;
  source: "pretext" | "dom" | "estimate";
  cached: boolean;
  contentVersion: string;
  fontVersion: string;
  width: number;
  styleKey: string;
}

interface CachedLayout {
  height: number;
  lineCount: number;
  source: "pretext" | "estimate";
}

interface PreparedEntry {
  text: string;
  contentVersion: string;
  fontVersion: string;
  styleKey: string;
  prepared: PreparedText | null;
  layouts: Map<string, CachedLayout>;
}

const styleKeyOf = (style: TextStyle) =>
  [
    style.font,
    style.lineHeight,
    style.letterSpacing ?? 0,
    style.whiteSpace ?? "normal",
    style.wordBreak ?? "normal",
  ].join("|");

const widthKeyOf = (width: number) => width.toFixed(2);

function fallbackEstimate(
  text: string,
  width: number,
  style: TextStyle,
): { height: number; lineCount: number } {
  if (!text) return { height: 0, lineCount: 0 };
  const fontSize = Number(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1]) || 13.8;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : fontSize * 20;
  const spacing = style.letterSpacing ?? 0;
  let advance = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    advance += (code > 0x2e7f ? 1 : 0.56) * fontSize + spacing;
    if (char === "\n") {
      advance += safeWidth;
    }
  }
  const lineCount = Math.max(1, Math.ceil(advance / safeWidth));
  return {
    height: lineCount * Math.max(1, style.lineHeight),
    lineCount,
  };
}

/** Caches Pretext `prepare` work per paragraph and `layout` work per width. */
export class TextLayoutCache {
  private readonly prepared = new Map<string, PreparedEntry>();
  private currentFontVersion: string;

  constructor(fontVersion = "initial") {
    this.currentFontVersion = fontVersion;
  }

  get fontVersion() {
    return this.currentFontVersion;
  }

  get size() {
    return this.prepared.size;
  }

  layout(
    key: string,
    text: string,
    width: number,
    style: TextStyle,
    request: ParagraphLayoutRequest,
  ): ParagraphLayout {
    const contentVersion = String(request.contentVersion);
    const styleKey = styleKeyOf(style);
    const widthKey = widthKeyOf(width);

    if (request.stable === false) {
      const domHeight = request.domHeight;
      const fallback =
        typeof domHeight === "number" && Number.isFinite(domHeight)
          ? {
              height: Math.max(0, domHeight),
              lineCount:
                domHeight > 0 ? Math.round(domHeight / style.lineHeight) : 0,
            }
          : fallbackEstimate(text, width, style);
      return {
        ...fallback,
        source:
          typeof domHeight === "number" && Number.isFinite(domHeight)
            ? "dom"
            : "estimate",
        cached: false,
        contentVersion,
        fontVersion: this.currentFontVersion,
        width,
        styleKey,
      };
    }

    let entry = this.prepared.get(key);
    if (
      !entry ||
      entry.contentVersion !== contentVersion ||
      entry.fontVersion !== this.currentFontVersion ||
      entry.styleKey !== styleKey ||
      entry.text !== text
    ) {
      let prepared: PreparedText | null = null;
      try {
        prepared = prepare(text, style.font, {
          ...(style.whiteSpace ? { whiteSpace: style.whiteSpace } : {}),
          ...(style.wordBreak ? { wordBreak: style.wordBreak } : {}),
          ...(style.letterSpacing
            ? { letterSpacing: style.letterSpacing }
            : {}),
        });
      } catch {
        prepared = null;
      }
      entry = {
        text,
        contentVersion,
        fontVersion: this.currentFontVersion,
        styleKey,
        prepared,
        layouts: new Map(),
      };
      this.prepared.set(key, entry);
    }

    const cached = entry.layouts.get(widthKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
        contentVersion,
        fontVersion: this.currentFontVersion,
        width,
        styleKey,
      };
    }

    let measured: CachedLayout;
    if (entry.prepared) {
      try {
        const result = layoutPrepared(entry.prepared, width, style.lineHeight);
        measured = { ...result, source: "pretext" };
      } catch {
        measured = { ...fallbackEstimate(text, width, style), source: "estimate" };
      }
    } else {
      measured = { ...fallbackEstimate(text, width, style), source: "estimate" };
    }
    entry.layouts.set(widthKey, measured);
    return {
      ...measured,
      cached: false,
      contentVersion,
      fontVersion: this.currentFontVersion,
      width,
      styleKey,
    };
  }

  invalidateFont(version?: string) {
    this.currentFontVersion = version ?? `${this.currentFontVersion}+`;
    this.prepared.clear();
    clearPretextCache();
  }

  clear() {
    this.prepared.clear();
  }
}

export function estimateTextHeight(
  text: string,
  width: number,
  style: TextStyle,
): number {
  return fallbackEstimate(text, width, style).height;
}

export function textLineCount(
  text: string,
  width: number,
  style: TextStyle,
): number {
  return fallbackEstimate(text, width, style).lineCount;
}
