import type { Vec } from "../core/types.ts";
import type { IconToken } from "../core/icons.ts";
import type { SymbolGeometry } from "../core/symbol-morph.ts";
import { svg } from "./dom.ts";

function symbolPathData(points: readonly Vec[]): string {
  return points.map((point, index) => `${index ? "L" : "M"}${Number(point.x.toFixed(3))} ${Number(point.y.toFixed(3))}`).join("");
}

export function populateIconGlyph(target: SVGGElement, token: IconToken) {
  target.replaceChildren();
  const strokeWidth = (
    token.baseStrokeWidth + token.strokeCompensation
  ).toFixed(2);
  const dx = (-12 + token.opticalOffset.x).toFixed(2);
  const dy = (-12 + token.opticalOffset.y).toFixed(2);
  target.setAttribute(
    "transform",
    `translate(12 12) scale(${token.opticalScale}) translate(${dx} ${dy})`,
  );
  target.setAttribute("stroke-width", strokeWidth);
  for (const shape of token.shapes) {
    svg(shape.tag, target, shape.attrs);
  }
}

/**
 * Render or update a dynamic SymbolGeometry in-place inside `target` (<g class="label-icon-glyph">),
 * preserving existing <path> and <circle> DOM nodes across all intermediate morph frames m ∈ [0, 1].
 */
export function renderSymbolGeometryToGroup(
  target: SVGGElement,
  geom: SymbolGeometry,
  pathCache?: Map<string, SVGPathElement>,
  pointCache?: Map<string, SVGCircleElement>,
) {
  const { optical } = geom;
  const baseStroke = optical.baseStrokeWidth + optical.strokeCompensation;
  const dx = (-12 + optical.opticalOffset.x).toFixed(2);
  const dy = (-12 + optical.opticalOffset.y).toFixed(2);
  target.setAttribute(
    "transform",
    `translate(12 12) scale(${optical.opticalScale}) translate(${dx} ${dy})`,
  );
  target.setAttribute("stroke-width", baseStroke.toFixed(2));
  target.dataset.symbolKind = geom.kind;
  target.dataset.symbolMorph = geom.morph.toFixed(4);
  target.dataset.symbolActivity = geom.activity.toFixed(3);

  const canReuse =
    pathCache &&
    pointCache &&
    pathCache.size === geom.paths.length &&
    pointCache.size === geom.points.length &&
    geom.paths.every((p) => pathCache.has(p.id)) &&
    geom.points.every((pt) => pointCache.has(pt.id));

  if (!canReuse) {
    target.replaceChildren();
    pathCache?.clear();
    pointCache?.clear();
    for (const p of geom.paths) {
      const el = svg("path", target, {
        class: `symbol-path is-${p.role}`,
        "data-part-id": p.id,
        d: symbolPathData(p.points),
        fill: "none",
      });
      if (p.strokeScale !== undefined) {
        el.setAttribute(
          "stroke-width",
          (baseStroke * p.strokeScale).toFixed(2),
        );
      }
      if (p.opacity !== undefined) {
        el.setAttribute("opacity", p.opacity.toFixed(3));
      }
      pathCache?.set(p.id, el);
    }
    for (const pt of geom.points) {
      const el = svg("circle", target, {
        class: `symbol-point is-${pt.role}`,
        "data-part-id": pt.id,
        cx: pt.x.toFixed(3),
        cy: pt.y.toFixed(3),
        r: pt.r.toFixed(3),
        fill: pt.filled !== false ? "currentColor" : "none",
        stroke: pt.filled !== false ? "none" : "currentColor",
      });
      if (pt.opacity !== undefined) {
        el.setAttribute("opacity", pt.opacity.toFixed(3));
      }
      pointCache?.set(pt.id, el);
    }
    return;
  }

  for (const p of geom.paths) {
    const el = pathCache!.get(p.id)!;
    el.setAttribute("d", symbolPathData(p.points));
    if (p.strokeScale !== undefined) {
      el.setAttribute("stroke-width", (baseStroke * p.strokeScale).toFixed(2));
    }
  }
  for (const pt of geom.points) {
    const el = pointCache!.get(pt.id)!;
    el.setAttribute("cx", pt.x.toFixed(3));
    el.setAttribute("cy", pt.y.toFixed(3));
    el.setAttribute("r", pt.r.toFixed(3));
  }
}

