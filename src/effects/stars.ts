import type { Camera, Theme, Vec, Viewport } from "../core/types.ts";
import { clamp } from "../core/math.ts";
import { screenToWorld, worldToScreen } from "../geometry/field.ts";
import { svg } from "../rendering/dom.ts";

const hash = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
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
interface Trail {
  path: SVGPathElement;
  gradient: SVGLinearGradientElement;
}
interface Meteor {
  path: SVGPathElement;
  head: SVGCircleElement;
  gradient: SVGLinearGradientElement;
  cycle: number;
  origin: Vec;
}
let instance = 0;
export class Stars {
  private readonly root: SVGGElement;
  private readonly points: SVGCircleElement[] = [];
  private readonly trails: Trail[] = [];
  private readonly meteors: Meteor[] = [];
  private readonly stops: SVGStopElement[] = [];
  private lastKey = "";
  private lastPointKey = "";
  private lastTrailKey = "";
  private lastTheme: Theme | null = null;
  constructor(root: SVGGElement) {
    this.root = root;
    const defs = svg("defs", root),
      id = `starfield-${++instance}`;
    const gradient = (name: string) => {
      const g = svg("linearGradient", defs, {
        id: `${id}-${name}`,
        gradientUnits: "userSpaceOnUse",
      });
      for (const [offset, opacity] of [
        [0, 0],
        [0.45, 0.55],
        [1, 1],
      ])
        this.stops.push(svg("stop", g, { offset, "stop-opacity": opacity }));
      return g;
    };
    for (let i = 0; i < 384; i++)
      this.points.push(svg("circle", root, { class: "star-point" }));
    for (let i = 0; i < 72; i++) {
      const g = gradient(`trail-${i}`);
      this.trails.push({
        gradient: g,
        path: svg("path", root, {
          class: "star-trail",
          fill: "none",
          stroke: `url(#${id}-trail-${i})`,
          "stroke-linecap": "round",
        }),
      });
    }
    for (let i = 0; i < 2; i++) {
      const g = gradient(`meteor-${i}`);
      this.meteors.push({
        gradient: g,
        cycle: -1,
        origin: { x: 0, y: 0 },
        path: svg("path", root, {
          class: "star-meteor",
          fill: "none",
          stroke: `url(#${id}-meteor-${i})`,
          "stroke-linecap": "round",
        }),
        head: svg("circle", root, { class: "meteor-head" }),
      });
    }
  }
  private gradient(g: SVGLinearGradientElement, from: Vec, to: Vec) {
    g.setAttribute("x1", String(from.x));
    g.setAttribute("y1", String(from.y));
    g.setAttribute("x2", String(to.x));
    g.setAttribute("y2", String(to.y));
  }
  render(
    camera: Camera,
    viewport: Viewport,
    elapsed: number,
    theme: Theme,
    reduced: boolean,
    loading: boolean,
    quiet?: Vec,
  ) {
    const time = reduced ? 0 : elapsed;
    const key = JSON.stringify([
      camera,
      viewport,
      Math.floor(time / 40),
      theme,
      reduced,
      loading,
      quiet,
    ]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.root.style.opacity = loading ? "0.08" : "1";
    if (this.lastTheme !== theme) {
      this.stops.forEach((stop, i) =>
        stop.setAttribute("stop-color", palettes[theme][i % 3]),
      );
      this.lastTheme = theme;
    }
    if (loading) return;
    const opacity = (p: Vec, base: number) => {
      const proximity = quiet
        ? Math.exp(
            -(
              (p.x - quiet.x) ** 2 / 330 ** 2 +
              (p.y - quiet.y) ** 2 / 290 ** 2
            ),
          )
        : 0;
      return String(base * (1 - 0.88 * proximity));
    };
    const pointKey = JSON.stringify([
      camera,
      viewport,
      theme,
      Math.floor(time / 300),
      quiet,
    ]);
    if (pointKey !== this.lastPointKey) {
      this.lastPointKey = pointKey;
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
      let point = 0;
      for (let x = loX; x <= hiX; x++)
        for (let y = loY; y <= hiY; y++) {
          if (x % stride !== 0 || y % stride !== 0) continue;
          for (let i = 0; i < 10 && point < this.points.length; i++) {
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
            const circle = this.points[point++];
            circle.style.display = "";
            circle.setAttribute("cx", String(at.x));
            circle.setAttribute("cy", String(at.y));
            circle.setAttribute(
              "r",
              String((0.5 + hash(seed + 19) * 1.2) * camera.z),
            );
            circle.setAttribute("fill", palettes[theme][i % 3]);
            circle.style.opacity = opacity(
              world,
              (!(theme === "dark" || theme === "obsidian" || theme === "abyss") ? 0.48 : 0.8) *
                (0.8 + 0.2 * Math.sin(time / 1800 + seed)),
            );
          }
        }
      for (; point < this.points.length; point++)
        this.points[point].style.display = "none";
    }
    const trailKey = JSON.stringify([
      camera,
      viewport,
      theme,
      Math.floor(time / 120),
      quiet,
    ]);
    if (trailKey !== this.lastTrailKey) {
      this.lastTrailKey = trailKey;
      for (const [index, trail] of this.trails.entries()) {
        const tile = Math.floor(index / 8),
          slot = index % 8;
        const x = Math.floor(camera.x / 1200) + (tile % 3) - 1;
        const y = Math.floor(camera.y / 1200) + Math.floor(tile / 3) - 1;
        const seed = x * 104729 + y * 15485863 + slot * 97;
        const pole = { x: (x + 0.5) * 1200, y: (y + 0.5) * 1200 };
        const radius = 160 + slot * 100;
        const angle = hash(seed) * Math.PI * 2 + time * 0.000003;
        const arc = 0.6 + hash(seed + 1) * 0.85;
        const sample = (a: number) => ({
          x: pole.x + Math.cos(a) * radius,
          y: pole.y + Math.sin(a) * radius,
        });
        const start = sample(angle - arc),
          end = sample(angle),
          a = worldToScreen(start, camera, viewport),
          b = worldToScreen(end, camera, viewport);
        const r = radius * camera.z;
        trail.path.setAttribute(
          "d",
          `M${a.x} ${a.y}A${r} ${r} 0 0 1 ${b.x} ${b.y}`,
        );
        trail.path.setAttribute(
          "stroke-width",
          String((0.65 + hash(seed + 5) * 0.55) * camera.z),
        );
        trail.path.style.opacity = opacity(
          sample(angle - arc / 2),
          !(theme === "dark" || theme === "obsidian" || theme === "abyss") ? 0.3 : 0.52,
        );
        this.gradient(trail.gradient, a, b);
      }
    }
    this.meteors.forEach((meteor, i) => {
      const clock = time + i * 4400 + 1900,
        cycle = Math.floor(clock / 8800),
        phase = (clock % 8800) / 1250;
      const active = !reduced && phase < 1;
      meteor.path.style.display = meteor.head.style.display = active
        ? ""
        : "none";
      if (!active) return;
      if (meteor.cycle !== cycle) {
        meteor.cycle = cycle;
        meteor.origin = screenToWorld(
          {
            x: viewport.width * (0.1 + hash(cycle + i * 71) * 0.65),
            y: viewport.height * (0.04 + hash(cycle + i * 31 + 5) * 0.32),
          },
          camera,
          viewport,
        );
      }
      const t = clamp(phase, 0, 1),
        length = 180;
      const end = {
        x: meteor.origin.x + t * 680,
        y: meteor.origin.y + t * 390,
      };
      const start = { x: end.x - length, y: end.y - length * 0.57 };
      const a = worldToScreen(start, camera, viewport),
        b = worldToScreen(end, camera, viewport);
      meteor.path.setAttribute("d", `M${a.x} ${a.y}L${b.x} ${b.y}`);
      meteor.path.setAttribute("stroke-width", String(1.7 * camera.z));
      meteor.head.setAttribute("cx", String(b.x));
      meteor.head.setAttribute("cy", String(b.y));
      meteor.head.setAttribute("r", String(1.8 * camera.z));
      meteor.head.setAttribute("fill", palettes[theme][2]);
      const alpha = opacity(
        end,
        Math.sin(Math.PI * t) * (!(theme === "dark" || theme === "obsidian" || theme === "abyss") ? 0.52 : 0.9),
      );
      meteor.path.style.opacity = meteor.head.style.opacity = alpha;
      this.gradient(meteor.gradient, a, b);
    });
  }
}
