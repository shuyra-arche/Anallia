import { clamp } from "../core/math.ts";
import { L_DUR } from "../geometry/loading.ts";
import {
  arcPathData,
  circlePathData,
  polylinePathData,
} from "../rendering/loading.ts";
import { evaluateLoadingGeometry } from "../geometry/loading.ts";

const AUTO_EXIT = L_DUR.intro + L_DUR.introArc + L_DUR.loop;
const EXIT_SECONDS = 0.2;
const IDENTITY = {
  anchor: { x: 220, y: 220 },
  angle: 0,
  scale: 1,
  theme: "light",
};

/** The original V24 drawing kernel owns only its supplied SVG subtree. */
/**
 * @param {HTMLElement} root
 * @param {() => void} onFinish
 * @param {(description: string) => void} onDescription
 */
export function createLoading(root, onFinish, onDescription) {
  const $ = (selector) => root.querySelector(selector);
  const descBar = {
    set textContent(value) {
      onDescription(value);
    },
  };
  const paths = {
    circle0: $("#circle0"),
    circle1: $("#circle1"),
    circle2: $("#circle2"),
    straight0: $("#straight0"),
    straight1: $("#straight1"),
    straight2: $("#straight2"),
    mark0: $("#mark0"),
    mark1: $("#mark1"),
    "arc-fine0": $("#arc-fine0"),
    "arc-fine1": $("#arc-fine1"),
    tip0: $("#tip0"),
    tip1: $("#tip1"),
    tip2: $("#tip2"),
  };
  let active = false;
  let lifeElapsed = 0;
  let visibleTime = 0;
  let exitStarted = null;
  let exitBaseTime = 0;
  let reduced = false;

  const setPath = (id, d) => {
    const element = paths[id];
    if (!element) return;
    if (element.getAttribute("d") !== d) element.setAttribute("d", d);
    const display = d ? "" : "none";
    if (element.style.display !== display) element.style.display = display;
  };

  function paint(time, exit) {
    const geometry = evaluateLoadingGeometry(time, {
      placement: IDENTITY,
      phase: exitStarted === null ? "waiting" : "leaving",
      exit,
      reducedMotion: reduced,
      streaming: false,
    });
    /** @type {Map<string, string>} */
    const data = new Map();
    for (const circle of geometry.circles)
      data.set(circle.id, circlePathData(circle));
    for (const arc of geometry.arcs) data.set(arc.id, arcPathData(arc));
    for (const line of geometry.points)
      data.set(line.id, polylinePathData(line));
    for (const id of Object.keys(paths)) setPath(id, data.get(id) ?? "");
  }

  function describe() {
    if (exitStarted !== null) {
      descBar.textContent = "Shuyra Loading · 离场：从当前姿态收拢";
      return;
    }
    if (visibleTime < L_DUR.intro) {
      descBar.textContent = "Shuyra Loading · 三圆从公共切点依次展开";
    } else if (visibleTime < L_DUR.intro + L_DUR.introArc) {
      descBar.textContent = "Shuyra Loading · 标记主复变换起点";
    } else {
      descBar.textContent = "Shuyra Loading · 相切三圆沿主变换连续穿越";
    }
  }

  function beginExit() {
    if (exitStarted !== null) return;
    exitBaseTime = Math.min(visibleTime, AUTO_EXIT);
    exitStarted = lifeElapsed;
  }

  function finish() {
    active = false;
    onFinish();
  }

  return {
    start() {
      active = true;
      lifeElapsed = 0;
      visibleTime = 0;
      exitStarted = null;
      exitBaseTime = 0;
      reduced = false;
      descBar.textContent = "Shuyra Loading · 正在等待真实任务";
    },
    exit() {
      if (active) beginExit();
    },
    update(dt, speed = 1) {
      if (!active) return;
      const seconds = Math.max(0, Number.isFinite(dt) ? dt : 0) / 1000;
      lifeElapsed += seconds;
      reduced = speed < 0.5;

      if (exitStarted !== null) {
        const elapsed = lifeElapsed - exitStarted;
        const exit = clamp(elapsed / EXIT_SECONDS, 0, 1);
        paint(exitBaseTime, exit);
        describe();
        if (elapsed >= EXIT_SECONDS - 1e-9) finish();
        return;
      }

      if (!reduced)
        visibleTime +=
          seconds * Math.max(0, Number.isFinite(speed) ? speed : 1);

      if (lifeElapsed >= AUTO_EXIT) {
        beginExit();
        paint(exitBaseTime, 0);
        describe();
        return;
      }

      paint(visibleTime, 0);
      describe();
    },
  };
}
