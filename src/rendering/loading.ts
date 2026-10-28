import type { Theme } from "../core/types.ts";
import { BOUNDARY, PAPER, blendHex, isDarkTheme } from "../core/palette.ts";
import type {
  LoadingArc,
  LoadingCircle,
  LoadingGeometry,
  LoadingPolyline,
  LoadingShape,
  LoadingTone,
} from "../geometry/loading.ts";
import { loadingShapes } from "../geometry/loading.ts";

const PI = Math.PI;
const round = (n: number): number => Number(n.toFixed(4));
const finite = (n: number): boolean => Number.isFinite(n);

export interface LoadingPalette {
  ink: string;
  arc: string;
  fine: string;
  shimmer: string;
}

export function loadingPalette(theme: Theme): LoadingPalette {
  const paper = PAPER[theme];
  const boundary = BOUNDARY[theme];
  if (isDarkTheme(theme)) {
    return {
      ink: blendHex(boundary, "#ffffff", 0.62),
      arc: blendHex(paper, boundary, 0.55),
      fine: blendHex(paper, boundary, 0.34),
      shimmer: "#ffffff",
    };
  }
  return {
    ink: blendHex(paper, boundary, 0.88),
    arc: blendHex(paper, boundary, 0.5),
    fine: blendHex(paper, boundary, 0.32),
    shimmer: blendHex(paper, boundary, 0.66),
  };
}

export function loadingToneColor(theme: Theme, tone: LoadingTone): string {
  return loadingPalette(theme)[tone];
}

export function circlePathData(circle: LoadingCircle): string {
  if (!finite(circle.cx + circle.cy + circle.r) || circle.r <= 0) return "";
  const { cx, cy, r } = circle;
  return (
    `M${round(cx + r)} ${round(cy)} ` +
    `A${round(r)} ${round(r)} 0 1 1 ${round(cx - r)} ${round(cy)} ` +
    `A${round(r)} ${round(r)} 0 1 1 ${round(cx + r)} ${round(cy)}`
  );
}

export function arcPathData(arc: LoadingArc): string {
  if (
    !finite(arc.cx + arc.cy + arc.r + arc.startAngle + arc.endAngle) ||
    arc.r <= 0
  )
    return "";
  const delta = arc.endAngle - arc.startAngle;
  if (Math.abs(delta) < 1e-6) return "";
  const sweep = delta >= 0 ? 1 : 0;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (PI * 0.999)));
  const step = delta / segments;
  const start = arc.startAngle;
  let x = arc.cx + arc.r * Math.cos(start);
  let y = arc.cy + arc.r * Math.sin(start);
  let d = `M${round(x)} ${round(y)}`;
  for (let segment = 1; segment <= segments; segment++) {
    const angle = start + step * segment;
    x = arc.cx + arc.r * Math.cos(angle);
    y = arc.cy + arc.r * Math.sin(angle);
    d += ` A${round(arc.r)} ${round(arc.r)} 0 0 ${sweep} ${round(x)} ${round(y)}`;
  }
  return d;
}

export function polylinePathData(polyline: LoadingPolyline): string {
  if (polyline.points.length === 0) return "";
  return (
    polyline.points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`,
      )
      .join(" ") + (polyline.closed ? " Z" : "")
  );
}

/** Convert one numeric primitive to SVG path data without reading any SVG. */
export function loadingShapePath(shape: LoadingShape): string {
  if (shape.kind === "circle") return circlePathData(shape);
  if (shape.kind === "arc") return arcPathData(shape);
  return polylinePathData(shape);
}

function shapeKey(shape: LoadingShape): string {
  return `${shape.kind}:${shape.id}:${shape.tone}`;
}

interface PathRecord {
  element: SVGPathElement;
  d: string;
  weight: number;
  opacity: number;
  tone: string;
  stroke: string;
}

const records = new WeakMap<SVGGElement, Map<string, PathRecord>>();

function recordsFor(group: SVGGElement): Map<string, PathRecord> {
  let map = records.get(group);
  if (!map) {
    map = new Map();
    records.set(group, map);
  }
  return map;
}

function writePath(
  record: PathRecord,
  d: string,
  weight: number,
  opacity: number,
  tone: LoadingTone,
  stroke: string,
): void {
  const element = record.element;
  if (record.d !== d) {
    element.setAttribute("d", d);
    record.d = d;
  }
  if (record.weight !== weight) {
    element.setAttribute("stroke-width", String(weight));
    record.weight = weight;
  }
  if (record.opacity !== opacity) {
    element.setAttribute("stroke-opacity", String(opacity));
    record.opacity = opacity;
  }
  if (record.tone !== tone) {
    element.setAttribute("data-loading-tone", tone);
    record.tone = tone;
  }
  if (record.stroke !== stroke) {
    element.setAttribute("stroke", stroke);
    record.stroke = stroke;
  }
}

/**
 * Keyed SVG backend for numeric loading geometry. It never starts a clock and
 * never reads geometry back from paths; the caller supplies every frame.
 */
export function renderLoadingGeometry(
  group: SVGGElement,
  geometry: LoadingGeometry,
): void {
  const document = group.ownerDocument;
  const map = recordsFor(group);
  const palette = loadingPalette(geometry.theme);
  if (group.getAttribute("data-loading-theme") !== geometry.theme) {
    group.setAttribute("data-loading-theme", geometry.theme);
    group.style.setProperty("--loading-ink", palette.ink);
    group.style.setProperty("--loading-arc", palette.arc);
    group.style.setProperty("--loading-fine", palette.fine);
    group.style.setProperty("--loading-shimmer", palette.shimmer);
  }
  const wanted = new Set<string>();
  for (const shape of loadingShapes(geometry)) {
    const d = loadingShapePath(shape);
    if (!d) continue;
    const key = shapeKey(shape);
    wanted.add(key);
    let record = map.get(key);
    if (record && record.element.parentNode !== group) {
      map.delete(key);
      record = undefined;
    }
    if (!record) {
      const element = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      element.setAttribute("fill", "none");
      element.setAttribute("stroke-linecap", "round");
      element.setAttribute("stroke-linejoin", "round");
      element.setAttribute("data-loading-shape", shape.id);
      group.appendChild(element);
      record = {
        element,
        d: "",
        weight: NaN,
        opacity: NaN,
        tone: "",
        stroke: "",
      };
      map.set(key, record);
    }
    writePath(
      record,
      d,
      shape.weight,
      shape.opacity,
      shape.tone,
      palette[shape.tone],
    );
  }
  for (const [key, record] of map) {
    if (wanted.has(key)) continue;
    record.element.remove();
    map.delete(key);
  }
}

export function clearLoadingGeometry(group: SVGGElement): void {
  for (const element of [...group.querySelectorAll("[data-loading-shape]")]) {
    element.remove();
  }
  recordsFor(group).clear();
  group.removeAttribute("data-loading-theme");
}

export class SvgLoadingRenderer {
  readonly group: SVGGElement;

  constructor(group: SVGGElement) {
    this.group = group;
  }

  render(geometry: LoadingGeometry): void {
    renderLoadingGeometry(this.group, geometry);
  }

  clear(): void {
    clearLoadingGeometry(this.group);
  }
}
