import type { Field } from "../application/field.ts";
import type { Scene } from "../rendering/scene.ts";
import type { SceneFrame } from "../core/graphics.ts";
import type { FieldState } from "../core/types.ts";
import { hubInk } from "../core/palette.ts";
import { TideLabelMotion } from "./tide-label-motion.ts";
import { tideLocalWindow } from "./tide-local-window.ts";

/** Keyboard proxies follow the actual hub curves; they draw no extra labels. */
export function installTideHubControls(
  host: HTMLElement,
  runtime: { field: Field; scene: Scene },
): () => void {
  const { field, scene } = runtime;
  const motion = new TideLabelMotion(field.catalog),
    doc = host.ownerDocument;
  const group = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("tide-hub-targets");
  host.querySelector("#gGeometry")!.append(group);
  const paths = new Map<string, SVGPathElement>();
  const renderTargets = (frame: SceneFrame, state: Readonly<FieldState>) => {
    const present = new Set<string>();
    if (state.overview)
      for (const hit of frame.hitRegions) {
        if (hit.graspKind !== "hub" || !hit.hubId || hit.hubId === state.focus)
          continue;
        const hub = state.hubs[hit.hubId],
          shape = hit.shape;
        let d = "";
        if (shape.type === "circle")
          d = `M${shape.x + shape.radius} ${shape.y}a${shape.radius} ${shape.radius} 0 1 0 ${-2 * shape.radius} 0a${shape.radius} ${shape.radius} 0 1 0 ${2 * shape.radius} 0`;
        else if (shape.type === "polyline")
          d = shape.points
            .map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`)
            .join("");
        if (!d) continue;
        present.add(hit.id);
        let path = paths.get(hit.id);
        if (!path) {
          path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
          path.classList.add("tide-hub-curve");
          path.setAttribute("role", "button");
          path.setAttribute("fill", "none");
          path.setAttribute("tabindex", "0");
          path.dataset.command = hit.id;
          group.append(path);
          paths.set(hit.id, path);
        }
        path.style.display = "";
        path.setAttribute("d", d);
        path.style.setProperty(
          "--tide-hub-ink",
          hubInk(hub.theme, frame.visualTheme),
        );
        path.setAttribute(
          "aria-label",
          `${hub.glyph}枢的曲线：${field.catalog.get(hub.root).title}；按 Enter 进入`,
        );
      }
    for (const [id, path] of paths)
      if (!present.has(id)) path.style.display = "none";
  };
  field.setLocalScrollLimit(
    () => tideLocalWindow(field.state, field.catalog).maxScroll,
  );
  scene.setFrameProjection(
    (base, state, feedback) => {
      const frame = motion.project(base, state, feedback);
      renderTargets(frame, state);
      return frame;
    },
    () => motion.isAnimating,
  );
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    scene.setFrameProjection(undefined);
    field.setLocalScrollLimit(null);
    motion.clear();
    group.remove();
    paths.clear();
  };
}
