/** Document reader entry. Bundled consumers load styles.css explicitly. */
import "./styles.css";
import { mountReader as mountDocumentReader } from "./runtime/mount-reader.ts";
import type { ReaderDefinition } from "./core/content.ts";
import type { ReaderHandle, ReaderOptions } from "./core/reader.ts";

export function mountReader(
  host: HTMLElement,
  definition: ReaderDefinition,
  options?: ReaderOptions,
): ReaderHandle {
  return mountDocumentReader(host, definition, options);
}
export type {
  ReaderHandle,
  ReaderOptions,
  ReaderCommand,
  ReaderPlace,
  ReaderAnchor,
  ReaderSnapshot,
  ReaderState,
  ReaderRestoration,
  ReaderRequest,
  ReaderListener,
} from "./core/reader.ts";
export type {
  ReaderDefinition,
  ContentManifest,
  ContentSource,
  TextPatch,
} from "./core/content.ts";
