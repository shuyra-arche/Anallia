import { READING_LINE_STEP } from "./geometry/circular-reading.ts";
import { frameRateLimit } from "./core/frame-rate.ts";
import { readFrameRate, saveFrameRate, readBackground, saveBackground, readSound, saveSound } from "./platform/preferences.ts";
import "./styles.css";
import { contentManifest } from "./content/generated/manifest.ts";
import { createLocalContentSource } from "./content/local.ts";
import { ContentStore } from "./content/store.ts";
import type { ContentSource } from "./core/content.ts";
import { Catalog } from "./content/catalog.ts";
import { Field } from "./application/field.ts";
import { ReadingSession } from "./application/reading-session.ts";
import { TaskGeometry } from "./application/task-geometry.ts";
import { Scene } from "./rendering/scene.ts";
import { frameFor } from "./geometry/field.ts";
import { THEME_OPTIONS } from "./core/palette.ts";
import { GeometricSoundscape } from "./effects/sound.ts";
import { requireElement } from "./rendering/dom.ts";
import { bindInput } from "./platform/input.ts";
import type { InputHit } from "./platform/input.ts";
import { startClock } from "./platform/clock.ts";

const host = requireElement<HTMLElement>(document, "#scene");
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
const params = new URLSearchParams(window.location.search);
const leavesModule = params.get("demo") === "leaves-ix" ? await import("./demos/leaves-ix.ts") : null;
const demo = leavesModule?.createLeavesIxDemo(contentManifest, createLocalContentSource());
const manifest = demo?.manifest ?? contentManifest;
let source: ContentSource = demo?.source ?? createLocalContentSource();
const store = new ContentStore({ open: (id, presentation, signal) => source.open(id, presentation, signal) });
const catalog = new Catalog(manifest.definitions, manifest, store);
const field = new Field(catalog, viewport(), motion.matches);
field.state.settings.frameRate = readFrameRate();
field.state.settings.background = readBackground();
field.state.settings.sound = readSound();
if (demo) {
  field.state.settings.background = "none";
  field.state.settings.sound = false;
}
let savedFrameRate = field.state.settings.frameRate;
let savedBackground = field.state.settings.background;
let savedSound = field.state.settings.sound !== false;
const chapterId = params.get("chapter") ?? demo?.entry;
if (chapterId && catalog.chapters.has(chapterId)) {
  const chapter = catalog.get(chapterId);
  const hub = field.state.hubs[chapter.hub];
  field.state.focus = hub.id;
  hub.path = catalog.chain(chapter.id);
  const siblings = catalog.siblings(chapter.id, field.state.searchResults);
  hub.scroll = hub.scrollTarget = Math.max(0, siblings.findIndex((node) => node.id === chapter.id));
  field.state.theme = hub.theme;
}
const morph = params.get("morph");
if (morph !== null && Number.isFinite(Number(morph))) field.hub.morph = field.hub.targetMorph = Math.max(0, Math.min(1, Number(morph)));
const theme = THEME_OPTIONS.find((option) => option.value === params.get("theme"));
if (theme) field.state.theme = theme.value;
field.state.camera = frameFor(field.hub, field.hub.scroll, field.siblings().length, field.state.camera, field.state.viewport);
const renderer = params.get("renderer");
const scene = new Scene(host, catalog, { renderer: renderer === "svg" ? "svg" : renderer === "gpu" ? "webgl" : "auto" });
const reading = new ReadingSession(field, store, (id, presentation) => scene.prepareContent(id, presentation), () => performance.now());
const tasks = new TaskGeometry();
const soundscape = new GeometricSoundscape();
const lifecycle = new AbortController();
const demoView = leavesModule?.mountLeavesIx(host, field, lifecycle.signal);
const updateVisibility = () => reading.setVisible(!document.hidden, performance.now());
document.addEventListener("visibilitychange", updateVisibility, { signal: lifecycle.signal });
updateVisibility();
host.dataset.booting = "true";

const status = document.createElement("aside");
status.id = "contentStatus";
status.setAttribute("role", "status");
status.setAttribute("aria-live", "polite");
const statusText = document.createElement("span");
const retry = document.createElement("button");
retry.type = "button";
retry.textContent = "重试";
retry.hidden = true;
retry.addEventListener("click", () => field.dispatch({ type: "navigate", target: "act:retry_content" }), { signal: lifecycle.signal });
const cancel = document.createElement("button");
cancel.type = "button";
cancel.textContent = "取消";
cancel.hidden = true;
cancel.addEventListener("click", () => reading.cancel(), { signal: lifecycle.signal });
status.append(statusText, retry, cancel);
host.append(status);
let hovered: InputHit | null = null;
host.dataset.sharedInput = "true";
const disposeInput = bindInput(host, {
  dispatch: (command) => field.dispatch(command),
  pan: (delta, start) => reading.view(() => field.pan(delta, start)),
  zoom: (factor, point) => reading.view(() => field.zoom(factor, point)),
  rotate: (delta, point) => reading.view(() => field.rotate(delta, point)),
  camera: () => field.state.camera,
  geometricReading: () => {
    const article = document.getElementById(`text-${field.selected().id}`);
    return article?.dataset.readingLayout === "geometric" && field.hub.morph < 0.0001
      ? { maxOffset: Number(article.dataset.maxFloat ?? 0), step: READING_LINE_STEP } : null;
  },
  grasp: (delta) => reading.grasp(delta),
  graspGeometry: () => field.graspGeometry(),
  overview: () => field.state.overview,
  loading: () => !reading.bootReady,
  exitLoading: () => { reading.cancel(); },
  cancelLoading: () => reading.cancel(),
  resolve: (key) => scene.actions.get(key),
  hitTest: (point) => {
    const hit = scene.hitTest(point);
    return hit ? { id: hit.id, command: hit.command, localScrollHub: hit.localScrollHub, grasp: (hit.graspKind === "hub" && hit.hubId === field.state.focus) || (hit.graspKind === "label" && hit.command.type === "morph") } : null;
  },
  hover: (hit) => {
    if (hovered?.id !== hit?.id) {
      if (hovered) scene.setSymbolInteraction(hovered.id, { hover: false });
      hovered = hit;
      if (hit) scene.setSymbolInteraction(hit.id, { hover: true });
      host.style.cursor = hit ? "pointer" : "";
    }
    scene.setHoveredTarget(hit?.command.type === "navigate" && !hit.command.target.startsWith("act:") ? hit.command.target : hit?.command.type === "focus" ? `hub:${hit.command.hub}` : null);

  },
});
const unlockAudio = () => soundscape.unlock();
for (const event of ["pointerdown", "wheel", "keydown"]) window.addEventListener(event, unlockAudio, { signal: lifecycle.signal, passive: true });
window.addEventListener("resize", () => { scene.invalidateLayout(); field.resize(viewport()); }, { signal: lifecycle.signal });
motion.addEventListener("change", () => field.setSystemReducedMotion(motion.matches), { signal: lifecycle.signal });

const stopClock = startClock((now, dt) => {
  const changes = reading.flush(now);
  if (changes.length) scene.invalidateContent(changes.map((change) => change.id));
  scene.setRetainedReading(reading.retainedReadingView);
  field.update(now, dt);
  soundscape.update(field.state, dt);
  if (savedBackground !== field.state.settings.background) {
    if (!demo) saveBackground(field.state.settings.background);
    savedBackground = field.state.settings.background;
  }
  if (savedFrameRate !== field.state.settings.frameRate) {
    if (!demo) saveFrameRate(field.state.settings.frameRate);
    savedFrameRate = field.state.settings.frameRate;
  }
  if (savedSound !== (field.state.settings.sound !== false)) {
    if (!demo) saveSound(field.state.settings.sound !== false);
    savedSound = field.state.settings.sound !== false;
  }
  const task = reading.activeTask;
  scene.setLoadingGeometry(tasks.update(task, field.state, catalog, dt));
  demoView?.update();
  scene.render(field.state);
  for (const correction of scene.takeReadingCorrections()) {
    if (correction.readingRows !== undefined) field.setReadingRows(correction.chapterId, correction.presentation, correction.readingRows);
    if (correction.textOffset !== undefined) reading.restoreReadingOffset(correction.chapterId, correction.presentation, correction.textOffset);
  }
  reading.afterRender((id, presentation) => {
    const article = document.getElementById(`text-${id}`);
    return article instanceof HTMLElement && !article.hidden && article.dataset.presentation === presentation;
  });
  if (reading.bootReady) delete host.dataset.booting;
  if (reading.bootReady && !reading.retainedChapterId) field.fitReading(scene.readingBounds);
  const message = reading.error ? "内容暂时无法打开。" : task && !task.outcome ? task.firstReadable ? "正文正在继续接收…" : "正在准备篇章…" : "";
  if (statusText.textContent !== message) statusText.textContent = message;
  if (retry.hidden !== !reading.error) retry.hidden = !reading.error;
  cancel.hidden = !task?.cancellable || Boolean(task.outcome);
  status.hidden = !message;
}, () => frameRateLimit(field.state.settings.frameRate, field.isAnimating || scene.isAnimating || reading.activeTask !== null));
reading.startup(field.selected().id, scene.initialize(), performance.now());

function useContentSource(next: ContentSource): void {
  if (!next || typeof next.open !== "function") throw new TypeError("ContentSource.open is required");
  source = next;
  reading.refresh();
}
(window as unknown as Record<string, unknown>).__shuyra = { field, scene, soundscape, reading, store, ready: reading.ready, ...(import.meta.env.DEV ? { useContentSource } : {}) };
document.fonts?.ready.then(() => scene.invalidateLayout(true));
document.fonts?.addEventListener("loadingdone", () => scene.invalidateLayout(true), { signal: lifecycle.signal });
if (import.meta.hot) import.meta.hot.dispose(() => {
  stopClock(); disposeInput(); reading.destroy(); lifecycle.abort(); scene.destroy(); status.remove();
});
