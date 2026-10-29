import type { Theme } from "../../core/types.ts";
import type { IconToken, IconShape } from "../../core/icons.ts";
import type { SymbolGeometry } from "../../core/symbol-morph.ts";
import { parseSvgPathData } from "../../geometry/graphics.ts";
import type { Vec } from "../../core/types.ts";

export interface GlyphEnvironment {
  theme: Theme;
  dpr: number;
  fontFamily: string;
  fontVersion?: string;
}

function environmentKey(env: GlyphEnvironment): string {
  return [env.theme, env.dpr, env.fontFamily, env.fontVersion ?? ""].join("|");
}

/**
 * Small cache for GPU label glyphs and icon geometry. Text/icon textures are
 * expensive; static icons are parsed once, symbols are quantized and parsed
 * only when a new bucket is requested. Theme, DPR or font changes invalidate
 * the whole cache so cached textures never leak across visual contexts.
 */
export class GpuGlyphCache<T = unknown> {
  private readonly values = new Map<string, T>();
  private environment = "";
  private invalidations = 0;

  private readonly dispose?: (value: T) => void;

  constructor(dispose?: (value: T) => void) { this.dispose = dispose; }

  items(): IterableIterator<T> { return this.values.values(); }

  get size(): number {
    return this.values.size;
  }

  get invalidationCount(): number {
    return this.invalidations;
  }

  setEnvironment(env: GlyphEnvironment): boolean {
    const key = environmentKey(env);
    if (key === this.environment) return false;
    const first = this.environment === "";
    this.environment = key;
    if (first) return false;
    this.clear("environment");
    return true;
  }

  getOrCreate(key: string, create: () => T): T {
    const existing = this.values.get(key);
    if (existing !== undefined) {
      this.values.delete(key);
      this.values.set(key, existing);
      return existing;
    }
    const value = create();
    this.values.set(key, value);
    if (this.values.size > 512) {
      const oldest = this.values.keys().next().value!;
      const discarded = this.values.get(oldest)!;
      this.values.delete(oldest);
      this.dispose?.(discarded);
    }
    return value;
  }

  get(key: string): T | undefined {
    return this.values.get(key);
  }

  clear(reason: "environment" | "theme" | "dpr" | "font" | "manual" = "manual"): void {
    for (const value of this.values.values()) this.dispose?.(value);
    this.values.clear();
    this.invalidations++;
    void reason;
  }
}

/** Parsed icon/symbol geometry cache keyed by the source data signature. */
export class IconGeometryCache {
  private readonly values = new Map<string, Vec[][]>();
  private readonly limit: number;

  constructor(limit = 256) {
    this.limit = limit;
  }

  get size(): number {
    return this.values.size;
  }

  getIcon(token: IconToken): Vec[][] {
    return this.getOrCreate(`icon:${token.id}`, () =>
      token.shapes.flatMap((shape) => this.parseShape(shape)),
    );
  }

  getSymbol(geometry: SymbolGeometry): Vec[][] {
    return geometry.paths.map(path => path.points.map(point => ({ ...point })));
  }

  getOrCreate(key: string, create: () => Vec[][]): Vec[][] {
    const existing = this.values.get(key);
    if (existing) return existing;
    const value = create();
    this.values.set(key, value);
    if (this.values.size > this.limit) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) this.values.delete(oldest);
    }
    return value;
  }

  clear(): void {
    this.values.clear();
  }

  private parseShape(shape: IconShape): Vec[][] {
    if (shape.tag === "path" && typeof shape.attrs.d === "string")
      return parseSvgPathData(shape.attrs.d);
    if (shape.tag === "circle") {
      const cx = Number(shape.attrs.cx);
      const cy = Number(shape.attrs.cy);
      const r = Number(shape.attrs.r);
      const points: Vec[] = [];
      for (let i = 0; i <= 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        points.push({
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
        });
      }
      return [points];
    }
    if (shape.tag === "line") {
      return [
        [
          { x: Number(shape.attrs.x1), y: Number(shape.attrs.y1) },
          { x: Number(shape.attrs.x2), y: Number(shape.attrs.y2) },
        ],
      ];
    }
    return [];
  }
}
