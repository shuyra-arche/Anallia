import {
  mountEmbeddedReader,
  type ReaderDefinition,
  type ReaderHandle,
} from "../src/embedded-reader.ts";
import { contentManifest } from "../src/content/generated/manifest.ts";
import { createLocalContentSource } from "../src/content/local.ts";
import { createFieldNotebook } from "../src/examples/field-notebook.ts";

const frameUrl = new URL("../reader-frame.html", location.href);
const definitions: Record<string, () => ReaderDefinition> = {
  primary: () => ({
    manifest: contentManifest,
    source: createLocalContentSource(),
    entry: "a1",
    title: "几何阅读",
  }),
  notebook: createFieldNotebook,
};
const readers = new Map<string, ReaderHandle>();
const status = document.querySelector<HTMLElement>("#status")!;
const mount = (id: string) => {
  const definition = definitions[id]();
  const renderer = new URLSearchParams(location.search).get("renderer");
  const reader = mountEmbeddedReader(document.getElementById(id)!, definition, {
    frameUrl,
    label: definition.title,
    renderer:
      renderer === "svg" ? "svg" : renderer === "gpu" ? "webgl" : "auto",
    settings: { sound: false },
  });
  readers.set(id, reader);
  void reader.ready.catch((error) => {
    status.textContent = `阅读器暂时无法打开：${String(error)}`;
  });
};
for (const id of Object.keys(definitions)) {
  mount(id);
  const button = document.querySelector<HTMLButtonElement>(`#toggle-${id}`)!;
  button.addEventListener("click", () => {
    const reader = readers.get(id);
    if (reader) {
      reader.destroy();
      readers.delete(id);
    } else mount(id);
    button.textContent = readers.has(id) ? "关闭" : "重新打开";
    button.setAttribute("aria-label", `${readers.has(id) ? "关闭" : "重新打开"}${id === "primary" ? "几何阅读" : "观察手册"}`);
  });
}
const dispose = () => {
  for (const reader of readers.values()) reader.destroy();
  readers.clear();
};
const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) dispose(); };
window.addEventListener("pagehide", onPageHide);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener("pagehide", onPageHide);
  dispose();
});
