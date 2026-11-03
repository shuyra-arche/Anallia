import type { ReaderDefinition } from "../core/content.ts";
import type {
  ReaderOptions,
  ReaderHandle,
  ReaderCommand,
} from "../core/reader.ts";
import { sceneTemplate } from "../rendering/scene-template.ts";
import { createReaderRuntime } from "./reader-runtime.ts";

export type {
  ReaderOptions,
  ReaderHandle,
  ReaderCommand,
} from "../core/reader.ts";
type Runtime = ReturnType<typeof createReaderRuntime>;
const runtimes = new WeakMap<ReaderHandle, Runtime>();
let active: ReaderHandle | null = null;

/** Internal shell integration, not re-exported from the consumer entry. */
export function readerRuntime(handle: ReaderHandle): Runtime {
  const runtime = runtimes.get(handle);
  if (!runtime) throw new Error("Reader is destroyed");
  return runtime;
}

/**
 * Mount the current document reader. One connected #scene per document is supported.
 * Fixed-position UI, SVG IDs, theme and keyboard listeners still own the document;
 * concurrent or cross-document mounts are rejected before either host is changed.
 */
export function mountReader(
  host: HTMLElement,
  definition: ReaderDefinition,
  options: ReaderOptions = {},
): ReaderHandle {
  if (active)
    throw new Error(
      "Anallia currently supports one mounted reader per document",
    );
  if (
    host.ownerDocument !== document ||
    !host.isConnected ||
    host.id !== "scene" ||
    document.querySelectorAll("#scene").length !== 1
  ) {
    throw new Error(
      "Mount requires the current document's single connected #scene host",
    );
  }
  if (!definition.source || typeof definition.source.open !== "function")
    throw new TypeError("ContentSource.open is required");
  const entry = options.chapter ?? definition.entry;
  if (!definition.manifest.chapters.some((chapter) => chapter.id === entry))
    throw new Error(`Unknown entry chapter: ${entry}`);
  const children = [...host.childNodes];
  const attributes = [...host.attributes].map(
    (attribute) => [attribute.name, attribute.value] as const,
  );
  const title = document.title;
  const theme = document.documentElement.getAttribute("data-theme");
  const restore = () => {
    host.replaceChildren(...children);
    for (const attribute of [...host.attributes])
      host.removeAttribute(attribute.name);
    for (const [name, value] of attributes) host.setAttribute(name, value);
    document.title = title;
    if (theme === null) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  };
  host.innerHTML = sceneTemplate;
  let runtime: Runtime;
  try {
    runtime = createReaderRuntime(host, definition, options);
    if (definition.title) document.title = definition.title;
  } catch (error) {
    restore();
    throw error;
  }
  let destroyed = false;
  let settleDestroyed!: (value: { status: "destroyed" }) => void;
  const aborted = new Promise<{ status: "destroyed" }>((resolve) => {
    settleDestroyed = resolve;
  });
  const handle: ReaderHandle = Object.freeze({
    ready: Promise.race([
      runtime.ready.then(() => ({ status: "ready" as const })),
      aborted,
    ]),
    dispatch(command: ReaderCommand) {
      if (destroyed) throw new Error("Reader is destroyed");
      runtime.dispatch({ ...command });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      settleDestroyed({ status: "destroyed" });
      try {
        runtime.destroy();
      } finally {
        runtimes.delete(handle);
        active = null;
        restore();
      }
    },
  });
  runtimes.set(handle, runtime);
  active = handle;
  return handle;
}
