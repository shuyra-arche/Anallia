import type { BackgroundMode } from "../../core/background.ts";
import type {
  BackgroundFrame,
  BackgroundStar,
  BackgroundStreamline,
  BackgroundTrail,
} from "../../core/graphics.ts";
import type { Camera, Theme, Vec, Viewport } from "../../core/types.ts";
import { clamp } from "../../core/math.ts";
import { screenToWorld, worldToScreen } from "../../geometry/field.ts";
import { flowSeeds, traceStreamline } from "../../effects/streamlines.ts";
import { sampleFlow } from "../../effects/flow-field.ts";
import type { WaveImpulse } from "../../effects/flow-field.ts";

const palettes: Record<Theme, readonly string[]> = {
  light: ["#6b9ba7", "#8585af", "#a87f58"],
  parchment: ["#a6856b", "#b08d74", "#b05a2b"],
  celadon: ["#7399a8", "#7ea1b0", "#9c6430"],
  rosewood: ["#9c7a8e", "#a68497", "#9e642e"],
  ivory: ["#7c8cb0", "#8796b8", "#9a6228"],
  dark: ["#546db6", "#7dbdcf", "#e4b78f"],
  obsidian: ["#626bc7", "#9dcfdf", "#eac0a3"],
  abyss: ["#4e6896", "#82b4f5", "#e8ba78"],
};

const darkTheme = (theme: Theme) =>
  theme === "dark" || theme === "obsidian" || theme === "abyss";

const hash = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export interface BackgroundFrameOptions {
  mode: BackgroundMode;
  camera: Camera;
  viewport: Viewport;
  elapsed: number;
  theme: Theme;
  reduced?: boolean;
  loading?: boolean;
  overview?: boolean;
  quiet?: Vec;
  impulses?: readonly WaveImpulse[];
}

function proximityOpacity(point: Vec, quiet: Vec | undefined, amount: number) {
  if (!quiet) return 1;
  const proximity = Math.exp(
    -(
      (point.x - quiet.x) ** 2 / 330 ** 2 +
      (point.y - quiet.y) ** 2 / 290 ** 2
    ),
  );
  return 1 - amount * proximity;
}

function flowLayer(
  camera: Camera,
  viewport: Viewport,
  elapsed: number,
  impulses: readonly WaveImpulse[],
  quiet: Vec | undefined,
): { streamlines: BackgroundStreamline[]; opacity: number } {
  const seeds = flowSeeds(camera);
  const streamlines = seeds.map((seed) => {
    const worldPoints = traceStreamline(seed, elapsed, impulses, 18, 28);
    const points = worldPoints.map((p) => worldToScreen(p, camera, viewport));
    const energy = sampleFlow(seed, elapsed, impulses).disturbance;
    const quietFactor = proximityOpacity(seed, quiet, 0.88);
    const markerQuiet = proximityOpacity(seed, quiet, 0.94);
    const phase =
      Math.sin(seed.x * 0.013 + seed.y * 0.019) * 43758.5453;
    const progress =
      ((elapsed / 1000) * 0.045 + phase - Math.floor(phase)) % 1;
    const cursor = progress * Math.max(0, points.length - 1);
    const a = points[Math.floor(cursor)] ?? seed;
    const b = points[Math.min(points.length - 1, Math.floor(cursor) + 1)] ?? a;
    const f = cursor - Math.floor(cursor);
    return {
      points,
      marker: {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
      },
      markerRadius: 1.7 * camera.z,
      width: 1.05 * camera.z,
      opacity: (0.2 + energy * 0.25) * quietFactor,
      markerOpacity: (0.18 + energy * 0.5) * markerQuiet,
    };
  });
  return { streamlines, opacity: 1 };
}

function starLayer(
  camera: Camera,
  viewport: Viewport,
  elapsed: number,
  theme: Theme,
  reduced: boolean,
  quiet: Vec | undefined,
): {
  stars: BackgroundStar[];
  trails: BackgroundTrail[];
  meteors: BackgroundFrame["meteors"];
} {
  const time = reduced ? 0 : elapsed;
  const colors = palettes[theme];
  const points: BackgroundStar[] = [];
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: 0, y: viewport.height },
    { x: viewport.width, y: viewport.height },
  ].map((p) => screenToWorld(p, camera, viewport));
  const loX = Math.floor(Math.min(...corners.map((p) => p.x)) / 300) - 1;
  const hiX = Math.ceil(Math.max(...corners.map((p) => p.x)) / 300) + 1;
  const loY = Math.floor(Math.min(...corners.map((p) => p.y)) / 300) - 1;
  const hiY = Math.ceil(Math.max(...corners.map((p) => p.y)) / 300) + 1;
  const stride = Math.max(
    1,
    Math.ceil(
      Math.sqrt(
        (viewport.width * viewport.height * 10) /
          (camera.z ** 2 * 300 ** 2 * 384),
      ),
    ),
  );
  for (let x = loX; x <= hiX && points.length < 384; x++) {
    for (let y = loY; y <= hiY && points.length < 384; y++) {
      if (x % stride !== 0 || y % stride !== 0) continue;
      for (let i = 0; i < 10 && points.length < 384; i++) {
        const seed = x * 104729 + y * 15485863 + i * 97;
        const world = {
          x: (x + hash(seed)) * 300,
          y: (y + hash(seed + 7)) * 300,
        };
        const at = worldToScreen(world, camera, viewport);
        if (
          at.x < -20 ||
          at.y < -20 ||
          at.x > viewport.width + 20 ||
          at.y > viewport.height + 20
        )
          continue;
        const base = darkTheme(theme) ? 0.8 : 0.48;
        points.push({
          at,
          radius: (0.5 + hash(seed + 19) * 1.2) * camera.z,
          fill: colors[i % 3],
          opacity:
            base *
            (0.8 + 0.2 * Math.sin(time / 1800 + seed)) *
            proximityOpacity(world, quiet, 0.88),
        });
      }
    }
  }
  const trails: BackgroundTrail[] = [];
  for (let index = 0; index < 72; index++) {
    const tile = Math.floor(index / 8);
    const slot = index % 8;
    const x = Math.floor(camera.x / 1200) + (tile % 3) - 1;
    const y = Math.floor(camera.y / 1200) + Math.floor(tile / 3) - 1;
    const seed = x * 104729 + y * 15485863 + slot * 97;
    const pole = { x: (x + 0.5) * 1200, y: (y + 0.5) * 1200 };
    const radius = 160 + slot * 100;
    const angle = hash(seed) * Math.PI * 2 + time * 0.000003;
    const arc = 0.6 + hash(seed + 1) * 0.85;
    trails.push({
      center: worldToScreen(pole, camera, viewport),
      radius: radius * camera.z,
      startAngle: angle - arc,
      endAngle: angle,
      width: (0.65 + hash(seed + 5) * 0.55) * camera.z,
      opacity:
        (darkTheme(theme) ? 0.52 : 0.3) *
        proximityOpacity(pole, quiet, 0.88),
      color: colors[index % 3],
    });
  }
  const meteors: BackgroundFrame["meteors"] = [];
  for (let i = 0; i < 2; i++) {
    const clock = time + i * 4400 + 1900;
    const cycle = Math.floor(clock / 8800);
    const phase = (clock % 8800) / 1250;
    if (reduced || phase >= 1) continue;
    const t = clamp(phase, 0, 1);
    const origin = screenToWorld(
      {
        x: viewport.width * (0.1 + hash(cycle + i * 71) * 0.65),
        y: viewport.height * (0.04 + hash(cycle + i * 31 + 5) * 0.32),
      },
      camera,
      viewport,
    );
    const end = { x: origin.x + t * 680, y: origin.y + t * 390 };
    const start = { x: end.x - 180, y: end.y - 180 * 0.57 };
    meteors.push({
      from: worldToScreen(start, camera, viewport),
      to: worldToScreen(end, camera, viewport),
      head: worldToScreen(end, camera, viewport),
      headRadius: 1.8 * camera.z,
      width: 1.7 * camera.z,
      opacity:
        Math.sin(Math.PI * t) *
        (darkTheme(theme) ? 0.9 : 0.52) *
        proximityOpacity(end, quiet, 0.88),
      color: colors[2],
    });
  }
  return { stars: points, trails, meteors };
}

/** Build all background primitives as numeric batches; no SVG node is read. */
export function evaluateBackgroundFrame(
  options: BackgroundFrameOptions,
): BackgroundFrame {
  const frame: BackgroundFrame = {
    mode: options.mode,
    theme: options.theme,
    opacity: 0,
    streamlines: [],
    stars: [],
    trails: [],
    meteors: [],
  };
  if (options.mode === "none") return frame;
  const time = options.reduced ? 0 : options.elapsed;
  if (options.mode === "flow") {
    const flow = flowLayer(
      options.camera,
      options.viewport,
      options.reduced ? 0 : options.elapsed,
      options.impulses ?? [],
      options.quiet,
    );
    frame.streamlines = flow.streamlines;
    frame.opacity = options.loading ? 0.06 : options.overview ? 0.65 : 0.38;
    return frame;
  }
  const stars = starLayer(
    options.camera,
    options.viewport,
    time,
    options.theme,
    options.reduced ?? false,
    options.quiet,
  );
  frame.stars = stars.stars;
  frame.trails = stars.trails;
  frame.meteors = stars.meteors;
  frame.opacity = options.loading ? 0.08 : 1;
  return frame;
}

/**
 * Adapter with the same call shape as `Background.render`. The coordinator can
 * switch from the SVG `Background` instance to this numeric adapter when
 * `scene.rendererKind === "webgl"`, or keep `Background` for SVG fallback.
 */
export class GpuBackgroundAdapter {
  private frame: BackgroundFrame | null = null;

  render(
    mode: BackgroundMode,
    camera: Camera,
    viewport: Viewport,
    elapsed: number,
    impulses: readonly WaveImpulse[],
    overview: boolean,
    loading: boolean,
    theme: Theme,
    reduced: boolean,
    quiet?: Vec,
  ): BackgroundFrame {
    this.frame = evaluateBackgroundFrame({
      mode,
      camera,
      viewport,
      elapsed,
      theme,
      impulses,
      overview,
      loading,
      reduced,
      quiet,
    });
    return this.frame;
  }

  get current(): BackgroundFrame | null {
    return this.frame;
  }
}
