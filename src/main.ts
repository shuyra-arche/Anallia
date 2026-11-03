import {
  mountReader,
  type ReaderHandle,
  type ReaderDefinition,
} from "./reader.ts";
import { readerRuntime } from "./runtime/mount-reader.ts";
import {
  readFrameRate,
  saveFrameRate,
  readBackground,
  saveBackground,
  readSound,
  saveSound,
} from "./platform/preferences.ts";
import { contentManifest } from "./content/generated/manifest.ts";
import { createLocalContentSource } from "./content/local.ts";
import { THEME_OPTIONS } from "./core/palette.ts";
import { requireElement } from "./rendering/dom.ts";
import { createLeavesIxDemo, mountLeavesIx } from "./demos/leaves-ix.ts";
import { createFieldNotebook } from "./examples/field-notebook.ts";

const host = requireElement<HTMLElement>(document, "#scene");
let activeCleanup: (() => void) | null = null;

function bootSession(searchOverride?: string): void {
  activeCleanup?.();
  activeCleanup = null;
  const rawSearch = searchOverride ?? window.location.search;
  const params = new URLSearchParams(rawSearch);
  const isLeavesDemo = params.get("demo") === "leaves-ix" || params.has("ix");
  const definition: ReaderDefinition = isLeavesDemo
    ? createLeavesIxDemo(contentManifest, createLocalContentSource())
    : params.get("example") === "field-notebook"
      ? createFieldNotebook()
      : {
          manifest: contentManifest,
          source: createLocalContentSource(),
          entry: "a0",
          title: "Anallia · 几何阅读演示",
        };
  const requestedChapter = params.get("chapter");
  const renderer = params.get("renderer");
  const handle: ReaderHandle = mountReader(host, definition, {
    chapter: definition.manifest.chapters.some(
      (chapter) => chapter.id === requestedChapter,
    )
      ? requestedChapter!
      : undefined,
    morph: params.has("morph") ? Number(params.get("morph")) : undefined,
    theme: THEME_OPTIONS.find((option) => option.value === params.get("theme"))
      ?.value,
    renderer:
      renderer === "svg" ? "svg" : renderer === "gpu" ? "webgl" : "auto",
    settings: {
      frameRate: readFrameRate(),
      background: isLeavesDemo ? "none" : readBackground(),
      sound: isLeavesDemo ? false : readSound(),
    },
  });
  const runtime = readerRuntime(handle);
  const { field } = runtime;
  const lifecycle = new AbortController();
  let savedFrameRate = field.state.settings.frameRate;
  let savedBackground = field.state.settings.background;
  let savedSound = field.state.settings.sound !== false;
  const switchDemoMode = (nextDemo: "leaves-ix" | null) => {
    const nextParams = new URLSearchParams(rawSearch);
    nextParams.delete("ix");
    nextParams.delete("chapter");
    nextParams.delete("morph");
    if (nextDemo) nextParams.set("demo", nextDemo);
    else nextParams.delete("demo");
    const qs = nextParams.toString();
    const targetUrl = qs ? `?${qs}` : window.location.pathname || "/";
    try {
      window.history.pushState(null, "", targetUrl);
    } catch {
      // Ignore history security restrictions in file:// or sandboxed data: iframes
    }
    bootSession(qs ? `?${qs}` : "");
  };

  const demoView = isLeavesDemo
    ? mountLeavesIx(host, field, lifecycle.signal, () => switchDemoMode(null))
    : null;

  let portal: HTMLElement | null = null;
  if (!isLeavesDemo) {
    portal = document.createElement("aside");
    portal.id = "leavesIxPortal";
    portal.className = "ix-portal";
    portal.setAttribute("aria-label", "叶之屋第九章排版习作入口");
    portal.innerHTML = `
      <a class="ix-portal-link" href="?demo=leaves-ix" aria-label="进入叶之屋 · 迷宫习作" title="进入叶之屋 · 迷宫习作" data-enter-leaves-ix>
        <span class="ix-portal-badge">IX</span>
        <span class="ix-portal-copy">
          <strong>叶之屋 · 迷宫习作</strong>
          <small>另一种阅读实验 ↗</small>
        </span>
      </a>`;
    portal.addEventListener("pointerdown", (e) => e.stopPropagation(), {
      signal: lifecycle.signal,
    });
    portal.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        switchDemoMode("leaves-ix");
      },
      { signal: lifecycle.signal },
    );
    host.append(portal);
  }

  runtime.observeFrame(() => {
    demoView?.update();
    if (savedBackground !== field.state.settings.background) {
      if (!isLeavesDemo) saveBackground(field.state.settings.background);
      savedBackground = field.state.settings.background;
    }
    if (savedFrameRate !== field.state.settings.frameRate) {
      if (!isLeavesDemo) saveFrameRate(field.state.settings.frameRate);
      savedFrameRate = field.state.settings.frameRate;
    }
    if (savedSound !== (field.state.settings.sound !== false)) {
      if (!isLeavesDemo) saveSound(field.state.settings.sound !== false);
      savedSound = field.state.settings.sound !== false;
    }
  }, !isLeavesDemo);
  // Existing diagnostics remain shell-only; mountReader never exposes mutable state.
  const diagnostics = {
    field: runtime.field,
    scene: runtime.scene,
    soundscape: runtime.soundscape,
    reading: runtime.reading,
    store: runtime.store,
    ready: runtime.ready,
    switchDemoMode,
    ...(import.meta.env.DEV
      ? { useContentSource: runtime.useContentSource, handle }
      : {}),
  };
  (window as unknown as Record<string, unknown>).__shuyra = diagnostics;
  activeCleanup = () => {
    lifecycle.abort();
    portal?.remove();
    handle.destroy();
    const scope = window as unknown as Record<string, unknown>;
    if (scope.__shuyra === diagnostics) delete scope.__shuyra;
  };
}

bootSession();
const restoreSession = () => bootSession();
window.addEventListener("popstate", restoreSession);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener("popstate", restoreSession);
    activeCleanup?.();
  });
