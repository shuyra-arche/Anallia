import { frameRateLimit } from "./core/frame-rate";
import { readFrameRate, saveFrameRate } from "./platform/preferences";
import "./styles.css";
import { rawContent, hubDefinitions } from "./content/field";
import { Catalog } from "./content/catalog";
import { Field } from "./application/field";
import { Scene } from "./rendering/scene";
import { screenToWorld, frameFor } from "./geometry/field";
import { evaluateSymbol } from "./core/symbol-morph";
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

// Support deterministic URL parameters (?chapter=...&morph=...&theme=...&activity=...) for keyframe inspection
try {
  const params = new URLSearchParams(window.location.search);
  const chapterId = params.get("chapter");
  if (chapterId && field.catalog.chapters.has(chapterId)) {
    const ch = field.catalog.get(chapterId);
    const h = field.state.hubs[ch.hub];
    field.state.focus = h.id;
    h.path = field.catalog.chain(ch.id);
    const siblings = field.catalog.siblings(ch.id, field.state.searchResults);
    const idx = Math.max(
      0,
      siblings.findIndex((n) => n.id === ch.id),
    );
    h.scroll = h.scrollTarget = idx;
    field.state.theme = h.theme;
    field.state.camera = frameFor(
      h,
      idx,
      siblings.length,
      field.state.camera,
      field.state.viewport,
    );
  }
  const morphParam = params.get("morph");
  if (morphParam !== null) {
    const m = Math.max(0, Math.min(1, Number(morphParam)));
    if (Number.isFinite(m)) {
      field.hub.morph = m;
      field.hub.targetMorph = m;
      const siblings = field.siblings();
      const idx = Math.max(
        0,
        siblings.findIndex((n) => n.id === field.selected().id),
      );
      field.state.camera = frameFor(
        field.hub,
        idx,
        siblings.length,
        field.state.camera,
        field.state.viewport,
      );
    }
  }
  const themeParam = params.get("theme");
  if (
    themeParam === "light" ||
    themeParam === "dark" ||
    themeParam === "obsidian"
  ) {
    field.state.theme = themeParam;
  }
  const hoverSymbol = params.get("hoverSymbol");
  if (hoverSymbol) {
    scene.setSymbolInteraction(`${field.state.focus}:global:${hoverSymbol}`, {
      hover: true,
    });
  }
} catch {
  /* Ignore URL parameter parsing errors in restricted environments. */
}

(window as unknown as Record<string, unknown>).__shuyra = {
  field,
  scene,
  evaluateSymbol,
};

const disposeInput = bindInput(host, {
  dispatch: (command) => field.dispatch(command),
  pan: (delta, start) => field.pan(delta, start),
  zoom: (factor, point) => field.zoom(factor, point),
  camera: () => field.state.camera,
  grasp: (delta) => field.grasp(delta),
  graspGeometry: () => field.graspGeometry(),
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
  () => field.setSystemReducedMotion(motion.matches),
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
  () =>
    frameRateLimit(
      field.state.settings.frameRate,
      field.isAnimating || scene.isAnimating,
    ),
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
