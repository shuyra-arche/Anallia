import { mountReader } from "./reader.ts";
import { readerRuntime } from "./runtime/mount-reader.ts";
import { createTideAtlas } from "./examples/tide-atlas.ts";
import { mountTideEdition } from "./demos/tide-edition.ts";
import "./demos/tide-edition.css";
import { installTideHubControls } from "./demos/tide-hub-controls.ts";

const host = document.querySelector<HTMLElement>("#scene")!;
const params = new URLSearchParams(location.search);
const definition = createTideAtlas();
const requested = params.get("chapter");
const handle = mountReader(host, definition, {
  chapter: definition.manifest.chapters.some(
    (chapter) => chapter.id === requested,
  )
    ? requested!
    : undefined,
  renderer:
    params.get("renderer") === "svg"
      ? "svg"
      : params.get("renderer") === "gpu"
        ? "webgl"
        : "auto",
  settings: { sound: false, background: "none" },
});
const stopEdition = mountTideEdition(host, handle, definition);
// Development diagnostics stay outside the public reader contract.
const runtime = readerRuntime(handle);
const stopHubControls = installTideHubControls(host, runtime);
const stopLabels = handle.subscribe((state) => {
  if (state.status === "destroyed") stopHubControls();
});
const diagnostics = {
  field: runtime.field,
  scene: runtime.scene,
  ready: runtime.ready,
  ...(import.meta.env.DEV
    ? {
        handle,
        store: runtime.store,
        reading: runtime.reading,
        useContentSource: runtime.useContentSource,
      }
    : {}),
};
(window as unknown as Record<string, unknown>).__shuyra = diagnostics;
const destroy = () => {
  stopLabels();
  stopHubControls();
  stopEdition();
  handle.destroy();
  if ((window as unknown as Record<string, unknown>).__shuyra === diagnostics)
    delete (window as unknown as Record<string, unknown>).__shuyra;
};
const leave = (event: PageTransitionEvent) => {
  if (!event.persisted) destroy();
};
window.addEventListener("pagehide", leave);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", leave);
    destroy();
  });
