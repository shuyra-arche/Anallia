import type {
  ContentChange,
  ContentFlush,
  ContentRequest,
  Presentation,
} from "../core/content.ts";
import { Catalog } from "./catalog.ts";
import { contentManifest } from "./generated/manifest.ts";
import { createLocalContentSource } from "./local.ts";
import { ContentStore } from "./store.ts";
import type { LocalContentSource } from "./source.ts";

/**
 * Production content wiring: manifest metadata and search index are eager,
 * chapter bodies are loaded by the local source only when a stream starts.
 */
export class ContentRuntime {
  readonly catalog: Catalog;
  readonly store: ContentStore;
  readonly source: LocalContentSource;

  constructor() {
    this.source = createLocalContentSource();
    this.store = new ContentStore(this.source);
    this.catalog = new Catalog(contentManifest.definitions, contentManifest, this.store);
  }

  start(id: string, presentation: Presentation): ContentRequest {
    return this.store.start(id, presentation);
  }

  /** Call once per frame before rendering. */
  flush(): ContentFlush {
    const changes = this.store.flush();
    for (const change of changes) this.apply(change);
    return changes;
  }

  private apply(change: ContentChange) {
    if (change.status === "cancelled" || (!change.text && !change.complete)) return;
    this.catalog.updateExpression(
      change.id,
      change.presentation,
      change.text,
      change.complete,
    );
  }
}

export function createContentRuntime() {
  return new ContentRuntime();
}
