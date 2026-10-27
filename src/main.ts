import { frameRateLimit } from "./core/frame-rate";
import { readFrameRate, saveFrameRate } from "./platform/preferences";
import "./styles.css";
import { rawContent, hubDefinitions } from "./content/field";
import { Catalog } from "./content/catalog";
import { Field } from "./application/field";
import { Scene } from "./rendering/scene";
import { screenToWorld } from "./geometry/field";
import { Ambient } from "./effects/ambient";
import { createLoading } from "./effects/loading.js";
import { requireElement } from "./rendering/dom";
import { bindInput } from "./platform/input";
import { startClock } from "./platform/clock";
const host = requireElement<HTMLElement>(document, "#scene");
const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
const field = new Field(
  new Catalog(hubDefinitions, rawContent),
  viewport(),
  motion.matches,
);
field.state.settings.frameRate = readFrameRate();
let savedFrameRate = field.state.settings.frameRate;
const scene = new Scene(host, field.catalog);
const ambient = new Ambient(requireElement<SVGGElement>(host, "#gDecorations"));
const overlay = requireElement<HTMLElement>(host, "#loadingOverlay");
const loader = createLoading(
  overlay,
  () => field.dispatch({ type: "close-loading" }),
  (description: string) => (field.state.description = description),
);
const disposeInput = bindInput(host, {
  dispatch: (command) => field.dispatch(command),
  pan: (delta, start) => field.pan(delta, start),
  zoom: (factor, point) => field.zoom(factor, point),
  camera: () => field.state.camera,
  overview: () => field.state.overview,
  loading: () => field.state.loading,
  exitLoading: () => loader.exit(),
  resolve: (key) => scene.actions.get(key),
});
const lifecycle = new AbortController();
window.addEventListener("resize", () => field.resize(viewport()), {
  signal: lifecycle.signal,
});
motion.addEventListener(
  "change",
  () => (field.state.settings.reducedMotion = motion.matches),
  { signal: lifecycle.signal },
);
let wasLoading = false;
const stopClock = startClock(
  (now, dt) => {
    field.update(now, dt);
    if (savedFrameRate !== field.state.settings.frameRate) {
      savedFrameRate = field.state.settings.frameRate;
      saveFrameRate(savedFrameRate);
    }
    if (field.state.loading && !wasLoading) {
      loader.start();
      overlay.classList.add("active");
      overlay.setAttribute("role", "button");
      overlay.setAttribute("tabindex", "0");
      overlay.focus();
    }
    if (field.state.loading)
      loader.update(
        dt,
        field.state.settings.reducedMotion ? 0.25 : field.state.settings.speed,
      );
    if (!field.state.loading && wasLoading) {
      overlay.classList.remove("active");
      overlay.removeAttribute("tabindex");
      overlay.removeAttribute("role");
    }
    wasLoading = field.state.loading;
    scene.render(field.state);
    ambient.render(
      field.state.camera,
      field.state.viewport,
      field.state.settings.reducedMotion ? 0 : field.state.elapsed,
      field.impulses,
      field.state.overview,
      field.state.loading,
      field.state.overview
        ? undefined
        : screenToWorld(
            {
              x: field.state.viewport.width / 2 + 170,
              y: field.state.viewport.height / 2,
            },
            field.state.camera,
            field.state.viewport,
          ),
    );
  },
  () => frameRateLimit(field.state.settings.frameRate, field.isAnimating),
);
document.fonts?.ready.then(() => scene.invalidateLayout());
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopClock();
    disposeInput();
    lifecycle.abort();
    scene.destroy();
    requireElement(host, "#gDecorations").replaceChildren();
  });
