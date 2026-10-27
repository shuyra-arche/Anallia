import type { Camera, Vec, Viewport } from "../core/types.ts";
import { svg } from "../rendering/dom.ts";
import { sampleFlow, type WaveImpulse } from "./flow-field.ts";
import { flowSeeds, traceStreamline } from "./streamlines.ts";
interface FlowLine {
  path: SVGPathElement;
  marker: SVGCircleElement;
  points: Vec[];
  seed: Vec;
  energy: number;
}
export class Ambient {
  private root: SVGGElement;
  private lines: FlowLine[];
  private lastSample = -Infinity;
  private lastCell = "";
  private lastMode = "";
  private lastTransform = "";
  private lastOpacity = "";
  private lastPaint = -Infinity;
  constructor(root: SVGGElement) {
    this.root = root;
    this.lines = flowSeeds({ x: 0, y: 0 }).map((seed) => ({
      seed,
      points: [],
      energy: 0,
      path: svg("path", root, {
        class: "flow-line",
        fill: "none",
        "stroke-width": 1.05,
        "vector-effect": "non-scaling-stroke",
      }),
      marker: svg("circle", root, { class: "flow-marker", r: 1.7 }),
    }));
  }
  render(
    camera: Camera,
    viewport: Viewport,
    elapsed: number,
    impulses: readonly WaveImpulse[],
    overview: boolean,
    loading: boolean,
    quiet?: Vec,
  ) {
    const opacity = loading ? "0.06" : overview ? "0.65" : "0.38";
    if (opacity !== this.lastOpacity) {
      this.root.style.opacity = opacity;
      this.lastOpacity = opacity;
    }
    const transform = `translate(${viewport.width / 2} ${viewport.height / 2}) scale(${camera.z}) rotate(${camera.rotation}) translate(${-camera.x} ${-camera.y})`;
    const cameraChanged = transform !== this.lastTransform;
    if (cameraChanged) {
      this.root.setAttribute("transform", transform);
      this.lastTransform = transform;
    }
    if (loading || (!cameraChanged && elapsed === this.lastPaint)) return;
    this.lastPaint = elapsed;
    const cell = `${Math.floor(camera.x / 340)}:${Math.floor(camera.y / 270)}`;
    const mode = `${overview}:${!!quiet}:${loading}`;
    if (
      elapsed - this.lastSample >= (impulses.length ? 125 : 400) ||
      cell !== this.lastCell ||
      mode !== this.lastMode
    ) {
      const seeds = flowSeeds(camera);
      this.lines.forEach((line, index) => {
        line.seed = seeds[index];
        line.points = traceStreamline(line.seed, elapsed, impulses, 18, 28);
        line.energy = sampleFlow(line.seed, elapsed, impulses).disturbance;
        line.path.setAttribute(
          "d",
          line.points
            .map(
              (p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
            )
            .join(""),
        );
        const proximity = quiet
          ? Math.exp(
              -(
                (line.seed.x - quiet.x) ** 2 / 420 ** 2 +
                (line.seed.y - quiet.y) ** 2 / 280 ** 2
              ),
            )
          : 0;
        line.path.style.opacity = String(
          (0.2 + line.energy * 0.25) * (1 - proximity * 0.88),
        );
        line.marker.style.opacity = String(
          (0.18 + line.energy * 0.5) * (1 - proximity * 0.94),
        );
      });
      this.lastSample = elapsed;
      this.lastCell = cell;
      this.lastMode = mode;
    }
    this.lines.forEach((line) => {
      if (!line.points.length) return;
      const phase =
        Math.sin(line.seed.x * 0.013 + line.seed.y * 0.019) * 43758.5453;
      const progress =
        ((elapsed / 1000) * 0.045 + phase - Math.floor(phase)) % 1;
      const cursor = progress * (line.points.length - 1),
        a = line.points[Math.floor(cursor)],
        b =
          line.points[Math.min(line.points.length - 1, Math.floor(cursor) + 1)],
        f = cursor % 1;
      line.marker.setAttribute("cx", (a.x + (b.x - a.x) * f).toFixed(2));
      line.marker.setAttribute("cy", (a.y + (b.y - a.y) * f).toFixed(2));
      if (cameraChanged)
        line.marker.setAttribute("r", String(1.35 / Math.max(0.4, camera.z)));
    });
  }
}
