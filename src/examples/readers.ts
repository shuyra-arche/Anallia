import type { ReaderDefinition } from "../core/content.ts";
import { contentManifest } from "../content/generated/manifest.ts";
import { createLocalContentSource } from "../content/local.ts";
export { createFieldNotebook, createStaticFieldNotebook } from "./field-notebook.ts";

/** Optional example content; it is not a dependency of the public runtime entry. */
export function createGeometryReader(): ReaderDefinition {
  return {
    manifest: contentManifest,
    source: createLocalContentSource(),
    entry: "a0",
    title: "Anallia · 几何阅读演示",
  };
}
