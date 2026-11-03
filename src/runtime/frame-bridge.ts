import type { ReaderDefinition } from "../core/content.ts";
import type { ReaderHandle, ReaderOptions } from "../core/reader.ts";

/** Private same-origin host/frame handshake; not a consumer API. */
export interface ReaderFrameBridge {
  readonly version: 2;
  mount(definition: ReaderDefinition, options: ReaderOptions): ReaderHandle;
}
