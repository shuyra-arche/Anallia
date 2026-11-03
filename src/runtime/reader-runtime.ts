import { READING_LINE_STEP } from "../geometry/circular-reading.ts";
import { frameRateLimit } from "../core/frame-rate.ts";
import { commandReference } from "../core/command-reference.ts";
import { ContentStore } from "../content/store.ts";
import type { ContentSource, ReaderDefinition } from "../core/content.ts";
import { Catalog } from "../content/catalog.ts";
import { Field } from "../application/field.ts";
import { ReadingSession } from "../application/reading-session.ts";
import { TaskGeometry } from "../application/task-geometry.ts";
import { Scene } from "../rendering/scene.ts";
import { frameFor } from "../geometry/field.ts";
import { GeometricSoundscape } from "../effects/sound.ts";
import { bindInput } from "../platform/input.ts";
import type { InputHit } from "../platform/input.ts";
import { startClock } from "../platform/clock.ts";

import type { Command } from "../core/types.ts";
import type { ReaderOptions } from "../core/reader.ts";

/** Internal runtime. The consumer-facing entry deliberately does not expose Field. */
export function createReaderRuntime(
  host: HTMLElement,
  definition: ReaderDefinition,
  options: ReaderOptions,
) {
  const viewport = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const manifest = definition.manifest;
  let source: ContentSource = definition.source;
  let observer: (() => void) | undefined;
  let autoOverview = true;
  const cleanup: (() => void)[] = [];
  const dispose = () => {
    for (const stop of cleanup.splice(0).reverse()) stop();
  };
  try {
    const store = new ContentStore({
      open: (id, presentation, signal) => source.open(id, presentation, signal),
    });
    const catalog = new Catalog(manifest.definitions, manifest, store);
    cleanup.push(() => catalog.destroy());
    const field = new Field(catalog, viewport(), motion.matches);
    Object.assign(field.state.settings, options.settings);
    const chapterId = options.chapter ?? definition.entry;
    if (chapterId && catalog.chapters.has(chapterId)) {
      const chapter = catalog.get(chapterId);
      const hub = field.state.hubs[chapter.hub];
      field.state.focus = hub.id;
      hub.path = catalog.chain(chapter.id);
      const siblings = catalog.siblings(chapter.id, field.state.searchResults);
      hub.scroll = hub.scrollTarget = Math.max(
        0,
        siblings.findIndex((node) => node.id === chapter.id),
      );
      field.state.theme = hub.theme;
    }
    const morph = options.morph;
    if (morph !== undefined && Number.isFinite(Number(morph)))
      field.hub.morph = field.hub.targetMorph = Math.max(
        0,
        Math.min(1, Number(morph)),
      );
    if (options.theme) field.state.theme = options.theme;
    field.state.camera = frameFor(
      field.hub,
      field.hub.scroll,
      field.siblings().length,
      field.state.camera,
      field.state.viewport,
    );
    const scene = new Scene(host, catalog, {
      renderer: options.renderer ?? "auto",
    });
    cleanup.push(() => scene.destroy());
    const reading = new ReadingSession(
      field,
      store,
      (id, presentation) => scene.prepareContent(id, presentation),
      () => performance.now(),
    );
    cleanup.push(() => reading.destroy());
    const tasks = new TaskGeometry();
    const soundscape = new GeometricSoundscape();
    cleanup.push(() => soundscape.destroy());
    const lifecycle = new AbortController();
    cleanup.push(() => lifecycle.abort());

    const updateVisibility = () =>
      reading.setVisible(!document.hidden, performance.now());
    document.addEventListener("visibilitychange", updateVisibility, {
      signal: lifecycle.signal,
    });
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
    retry.addEventListener(
      "click",
      () => field.dispatch({ type: "navigate", target: "act:retry_content" }),
      { signal: lifecycle.signal },
    );
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.hidden = true;
    cancel.addEventListener("click", () => reading.cancel(), {
      signal: lifecycle.signal,
    });
    status.append(statusText, retry, cancel);
    host.append(status);
    cleanup.push(() => status.remove());

    let hovered: InputHit | null = null;
    let hoveredTarget: string | null = null;
    host.dataset.sharedInput = "true";
    const disposeInput = bindInput(host, {
      dispatch: (command) => field.dispatch(command),
      pan: (delta, start) => reading.view(() => field.pan(delta, start)),
      zoom: (factor, point) => reading.view(() => field.zoom(factor, point)),
      rotate: (delta, point) => reading.view(() => field.rotate(delta, point)),
      camera: () => field.state.camera,
      geometricReading: () => {
        const article = host.querySelector<HTMLElement>(
          `#text-${CSS.escape(field.selected().id)}`,
        );
        return article?.dataset.readingLayout === "geometric"
          ? {
              maxOffset: Number(article.dataset.maxFloat ?? 0),
              step: READING_LINE_STEP,
            }
          : null;
      },
      grasp: (delta) => reading.grasp(delta),
      graspGeometry: () => field.graspGeometry(),
      overview: () => field.state.overview,
      loading: () => !reading.bootReady,
      exitLoading: () => {
        reading.cancel();
      },
      cancelLoading: () => reading.cancel(),
      resolve: (key) => scene.actions.get(key),
      hitTest: (point) => {
        const hit = scene.hitTest(point);
        return hit
          ? {
              id: hit.id,
              command: hit.command,
              localScrollHub: hit.localScrollHub,
              grasp:
                (hit.graspKind === "hub" && hit.hubId === field.state.focus) ||
                (hit.graspKind === "label" && hit.command.type === "morph"),
            }
          : null;
      },
      hover: (hit) => {
        if (hovered?.id !== hit?.id) {
          if (hovered) scene.setSymbolInteraction(hovered.id, { hover: false });
          hovered = hit;
          if (hit) scene.setSymbolInteraction(hit.id, { hover: true });
          host.style.cursor = hit ? "pointer" : "";
        }
        // Moving the pointer resumes its channel even when the hit is unchanged
        // after keyboard focus temporarily became the active input.
        const nextTarget = commandReference(hit?.command);
        scene.setHoveredTarget(nextTarget, "pointer", hoveredTarget);
        hoveredTarget = nextTarget;
      },
    });
    cleanup.push(disposeInput);
    const unlockAudio = () => soundscape.unlock();
    for (const event of ["pointerdown", "wheel", "keydown"])
      host.addEventListener(event, unlockAudio, {
        signal: lifecycle.signal,
        passive: true,
        capture: true,
      });
    window.addEventListener(
      "resize",
      () => {
        scene.invalidateLayout();
        field.resize(viewport());
      },
      { signal: lifecycle.signal },
    );
    motion.addEventListener(
      "change",
      () => field.setSystemReducedMotion(motion.matches),
      { signal: lifecycle.signal },
    );

    const stopClock = startClock(
      (now, dt) => {
        const changes = reading.flush(now);
        if (changes.length)
          scene.invalidateContent(changes.map((change) => change.id));
        scene.setRetainedReading(reading.retainedReadingView);
        field.update(now, dt);
        soundscape.update(field.state, dt);
        const task = reading.activeTask;
        scene.setLoadingGeometry(tasks.update(task, field.state, catalog, dt));
        observer?.();
        scene.render(field.state);
        if (autoOverview) field.fitOverview(scene.overviewRegion);
        for (const correction of scene.takeReadingCorrections()) {
          if (correction.readingRows !== undefined)
            field.setReadingRows(
              correction.chapterId,
              correction.presentation,
              correction.readingRows,
            );
          if (correction.textOffset !== undefined)
            reading.restoreReadingOffset(
              correction.chapterId,
              correction.presentation,
              correction.textOffset,
            );
        }
        reading.afterRender((id, presentation) => {
          const article = host.querySelector<HTMLElement>(
            `#text-${CSS.escape(id)}`,
          );
          return (
            article instanceof HTMLElement &&
            !article.hidden &&
            article.dataset.presentation === presentation
          );
        });
        if (reading.bootReady) delete host.dataset.booting;
        if (reading.bootReady && !reading.retainedChapterId)
          field.fitReading(scene.readingBounds);
        const message = reading.error
          ? "内容暂时无法打开。"
          : task && !task.outcome
            ? task.firstReadable
              ? "正文正在继续接收…"
              : "正在准备篇章…"
            : "";
        if (statusText.textContent !== message)
          statusText.textContent = message;
        if (retry.hidden !== !reading.error) retry.hidden = !reading.error;
        cancel.hidden = !task?.cancellable || Boolean(task.outcome);
        status.hidden = !message;
      },
      () =>
        frameRateLimit(
          field.state.settings.frameRate,
          field.isAnimating || scene.isAnimating || reading.activeTask !== null,
        ),
    );
    cleanup.push(stopClock);
    reading.startup(field.selected().id, scene.initialize(), performance.now());

    function useContentSource(next: ContentSource): void {
      if (!next || typeof next.open !== "function")
        throw new TypeError("ContentSource.open is required");
      source = next;
      reading.refresh();
    }
    document.fonts?.ready.then(() => {
      if (!lifecycle.signal.aborted) scene.invalidateLayout(true);
    });
    document.fonts?.addEventListener(
      "loadingdone",
      () => scene.invalidateLayout(true),
      { signal: lifecycle.signal },
    );
    return {
      field,
      scene,
      reading,
      soundscape,
      store,
      ready: reading.ready,
      useContentSource,
      dispatch: (command: Command) => field.dispatch(command),
      observeFrame: (
        callback: (() => void) | undefined,
        fitOverview = true,
      ) => {
        observer = callback;
        autoOverview = fitOverview;
      },
      destroy: dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
