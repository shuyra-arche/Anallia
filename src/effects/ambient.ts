import type { Camera, Vec, Viewport } from "../core/types.ts";
import { rot } from "../core/math.ts";
import { worldToScreen } from "../geometry/field.ts";
import { svg } from "../rendering/dom.ts";
import { sampleFlow, type WaveImpulse } from "./flow-field.ts";
import { flowSeeds, traceStreamline } from "./streamlines.ts";

interface FlowLine {
  path: SVGPathElement;
  marker: SVGCircleElement;
  points: Vec[];
  screenPoints: Vec[];
  seed: Vec;
  energy: number;
}

export class Ambient {
  private root: SVGGElement;
  private lines: FlowLine[];
  private lastSample = -Infinity;
  private lastCell = "";
  private lastMode = "";
  private lastCameraKey = "";
  private lastOpacity = "";
  private lastPaint = -Infinity;

  constructor(root: SVGGElement) {
    this.root = root;
    this.lines = flowSeeds({ x: 0, y: 0 }).map((seed) => ({
      seed,
      points: [],
      screenPoints: [],
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

  private projectLineToScreen(
    line: FlowLine,
    camera: Camera,
    viewport: Viewport,
  ) {
    const anchor = worldToScreen(line.seed, camera, viewport);
    const rad = (camera.rotation * Math.PI) / 180;
    line.screenPoints = line.points.map((p) => {
      const local = rot({ x: p.x - line.seed.x, y: p.y - line.seed.y }, rad);
      return { x: anchor.x + local.x, y: anchor.y + local.y };
    });
    line.path.setAttribute(
      "d",
      line.screenPoints
        .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(""),
    );
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
    this.root.removeAttribute("transform");

    const cameraKey = `${camera.x.toFixed(2)}:${camera.y.toFixed(2)}:${camera.z.toFixed(4)}:${camera.rotation.toFixed(2)}:${viewport.width}:${viewport.height}`;
    const cameraChanged = cameraKey !== this.lastCameraKey;
    if (cameraChanged) {
      this.lastCameraKey = cameraKey;
    }
    if (loading || (!cameraChanged && elapsed === this.lastPaint)) return;
    this.lastPaint = elapsed;

    const cell = `${Math.floor(camera.x / 340)}:${Math.floor(camera.y / 270)}`;
    const mode = `${overview}:${!!quiet}:${loading}`;
    const resampled =
      elapsed - this.lastSample >= (impulses.length ? 125 : 400) ||
      cell !== this.lastCell ||
      mode !== this.lastMode;

    if (resampled) {
      const seeds = flowSeeds(camera);
      this.lines.forEach((line, index) => {
        line.seed = seeds[index];
        line.points = traceStreamline(line.seed, elapsed, impulses, 18, 28);
        line.energy = sampleFlow(line.seed, elapsed, impulses).disturbance;
        this.projectLineToScreen(line, camera, viewport);
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
    } else if (cameraChanged) {
      this.lines.forEach((line) => {
        if (line.points.length) {
          this.projectLineToScreen(line, camera, viewport);
        }
      });
    }

    this.lines.forEach((line) => {
      if (!line.screenPoints.length) return;
      const phase =
        Math.sin(line.seed.x * 0.013 + line.seed.y * 0.019) * 43758.5453;
      const progress =
        ((elapsed / 1000) * 0.045 + phase - Math.floor(phase)) % 1;
      const cursor = progress * (line.screenPoints.length - 1),
        a = line.screenPoints[Math.floor(cursor)],
        b =
          line.screenPoints[
            Math.min(line.screenPoints.length - 1, Math.floor(cursor) + 1)
          ],
        f = cursor % 1;
      line.marker.setAttribute("cx", (a.x + (b.x - a.x) * f).toFixed(2));
      line.marker.setAttribute("cy", (a.y + (b.y - a.y) * f).toFixed(2));
      line.marker.setAttribute("r", "1.7");
    });
  }
}
