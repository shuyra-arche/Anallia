import type {
  Chapter,
  ContentRow,
  HubDefinition,
} from "../core/types.ts";
import type {
  ContentDocument,
  ContentManifest,
  ManifestChapter,
  Presentation,
  SearchIndexEntry,
} from "../core/content.ts";
import { ContentStore } from "./store.ts";
import {
  buildSearchEntry,
  buildSearchHaystack,
  searchEntryHaystack,
  updateSearchEntry,
} from "./search.ts";

export type CatalogRowsInput =
  | Record<string, ContentRow[]>
  | ContentManifest;

interface SearchItem {
  chapter: Chapter;
  sourceId: string;
}

function isManifest(value: CatalogRowsInput): value is ContentManifest {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as ContentManifest).chapters) &&
    Array.isArray((value as ContentManifest).definitions)
  );
}

export class Catalog {
  readonly chapters = new Map<string, Chapter>();
  readonly definitions: readonly HubDefinition[];
  readonly manifest?: ContentManifest;
  private content: ContentStore;
  private unsubscribeContent: (() => void) | null = null;
  private readonly mirrorSources = new Map<string, string>();
  private readonly searchPool: SearchItem[] = [];
  private readonly searchIndex = new Map<string, SearchIndexEntry>();

  get contentIdentity(): object { return this.content; }

  get searchHub() {
    return this.definitions.find((hub) => hub.kind === "search");
  }
  get searchRoot() {
    return this.searchHub?.root;
  }

  constructor(definitions: HubDefinition[], rows: CatalogRowsInput, store?: ContentStore) {
    this.definitions = definitions;
    this.content = store ?? new ContentStore();
    const hubs = new Set(definitions.map((h) => h.id));
    if (hubs.size !== definitions.length) throw new Error("Duplicate hub");
    const manifest = isManifest(rows) ? rows : undefined;
    this.manifest = manifest;

    if (manifest) {
      for (const meta of manifest.chapters) {
        if (!hubs.has(meta.hub)) throw new Error(`Unknown hub: ${meta.hub}`);
        this.addChapter(meta);
      }
    } else {
      const rowsByHub = rows as Record<string, ContentRow[]>;
      for (const [hub, content] of Object.entries(rowsByHub)) {
        if (!hubs.has(hub)) throw new Error(`Unknown hub: ${hub}`);
        for (const [id, name, parent, title, circle, line, refs] of content) {
          this.addChapter(
            {
              id,
              name,
              parent,
              title,
              hub,
              refs: refs.map(([glyph, target]) => ({ glyph, target })),
            },
            { circle, line },
            true,
          );
        }
      }
    }

    for (const node of this.chapters.values()) {
      if (node.parent) {
        const parent = this.get(node.parent);
        if (parent.hub !== node.hub)
          throw new Error(`Cross-hub parent: ${node.id}`);
        parent.children.push(node.id);
      }
      for (const ref of node.refs) this.get(ref.target);
      if (manifest) {
        for (const target of this.manifestChapter(node.id)?.inlineTargets ?? [])
          if (!target.startsWith("act:")) this.get(target);
      } else {
        for (const presentation of ["circle", "line"] as const) {
          for (const ref of this.content.document(node.id, presentation).references)
            if (!ref.target.startsWith("act:")) this.get(ref.target);
        }
      }
    }

    for (const def of definitions) {
      const root = this.get(def.root);
      if (root.parent || root.hub !== def.id)
        throw new Error(`Invalid root: ${def.root}`);
    }
    for (const node of this.chapters.values()) {
      const chain = this.chain(node.id);
      if (chain[0] !== definitions.find((h) => h.id === node.hub)?.root)
        throw new Error(`Disconnected chapter: ${node.id}`);
    }

    this.buildSearchIndex(manifest);
    if (manifest && store) {
      for (const id of this.chapters.keys()) for (const presentation of ["circle", "line"] as const) {
        const state = store.expression(id, presentation);
        const entry = this.searchIndex.get(id);
        if (entry && state.complete) updateSearchEntry(entry, presentation, state.text);
      }
    }
    this.buildSearchMirrors();
    this.observeContent();
  }

  private manifestChapter(id: string): ManifestChapter | undefined {
    return this.manifest?.chapters.find((chapter) => chapter.id === id);
  }

  private addChapter(
    meta: ManifestChapter,
    expressions?: { circle: string; line: string },
    complete = false,
  ) {
    if (this.chapters.has(meta.id))
      throw new Error(`Duplicate chapter: ${meta.id}`);
    const chapter: Chapter = {
      id: meta.id,
      name: meta.name,
      parent: meta.parent,
      title: meta.title,
      expressions: { circle: "", line: "" },
      refs: meta.refs.map((ref) => ({ ...ref })),
      children: [],
      hub: meta.hub,
    };
    Object.defineProperty(chapter, "expressions", {
      enumerable: true,
      configurable: true,
      get: () => this.expressionsFor(meta.id),
    });
    for (const presentation of ["circle", "line"] as const)
      this.content.seed(meta.id, presentation, expressions?.[presentation] ?? "", complete);
    this.chapters.set(meta.id, chapter);
  }

  private expressionsFor(id: string): { circle: string; line: string } {
    return { circle: this.content.expression(id, "circle").text, line: this.content.expression(id, "line").text };
  }

  private expressionState(id: string, presentation: Presentation) {
    if (!this.chapters.has(id)) throw new Error(`Unknown chapter: ${id}`);
    return this.content.expression(this.mirrorSources.get(id) ?? id, presentation);
  }

  private observeContent(): void {
    this.unsubscribeContent?.();
    this.unsubscribeContent = this.content.subscribePublished((id, presentation, state) => {
      const entry = this.searchIndex.get(id);
      if (entry && state.complete) updateSearchEntry(entry, presentation, state.text);
    });
  }

  bindContentStore(store: ContentStore): void {
    if (store === this.content) return;
    for (const id of this.chapters.keys()) {
      if (this.mirrorSources.has(id)) continue;
      for (const presentation of ["circle", "line"] as const) {
        const state = this.content.expression(id, presentation);
        store.seed(id, presentation, state.text, state.complete);
        const next = store.expression(id, presentation);
        const entry = this.searchIndex.get(id);
        if (entry && next.complete) updateSearchEntry(entry, presentation, next.text);
      }
    }
    this.content = store;
    this.observeContent();
  }

  private buildSearchIndex(manifest?: ContentManifest) {
    if (manifest) {
      for (const entry of manifest.searchIndex ?? [])
        this.searchIndex.set(entry.sourceId, { ...entry });
      return;
    }
    for (const id of this.chapters.keys()) {
      const chapter = this.chapters.get(id);
      if (!chapter) continue;
      this.searchIndex.set(
        id,
        buildSearchEntry({
          id,
          name: chapter.name,
          title: chapter.title,
          circle: this.content.expression(id, "circle").text,
          line: this.content.expression(id, "line").text,
        }),
      );
    }
  }

  private buildSearchMirrors() {
    const searchHub = this.searchHub;
    if (!searchHub) return;
    const sourceNodes = [...this.chapters.values()].filter(
      (node) => node.hub !== searchHub.id,
    );
    for (const node of sourceNodes) {
      const definition = this.definitions.find((hub) => hub.id === node.hub)!;
      const mirrorId = `q_hit_${node.id}`;
      const mirror: Chapter = {
        id: mirrorId,
        name: node.name,
        parent: null,
        title: `${definition.glyph} / ${node.name} · ${node.title}`,
        expressions: { circle: "", line: "" },
        refs: [{ glyph: definition.glyph, target: node.id }, ...node.refs],
        children: [],
        hub: searchHub.id,
      };
      Object.defineProperty(mirror, "expressions", {
        enumerable: true,
        configurable: true,
        get: () => {
          const source = this.get(node.id);
          const prefix = `{前往 ${definition.glyph} / ${node.name} 原枢阅读 ↗|${node.id}}\n\n`;
          return {
            circle: prefix + source.expressions.circle,
            line: prefix + source.expressions.line,
          };
        },
      });
      if (this.chapters.has(mirrorId))
        throw new Error(`Duplicate search result: ${mirrorId}`);
      this.chapters.set(mirrorId, mirror);
      this.mirrorSources.set(mirrorId, node.id);
      this.searchPool.push({ chapter: mirror, sourceId: node.id });
    }
  }

  private searchable(sourceId: string): string {
    const chapter = this.chapters.get(sourceId);
    if (!chapter) return "";
    const entry = this.searchIndex.get(sourceId);
    if (entry)
      return searchEntryHaystack(
        entry,
        chapter.id,
        chapter.name,
        chapter.title,
      );
    return buildSearchHaystack(
      chapter.id,
      chapter.name,
      chapter.title,
      chapter.expressions.circle,
      chapter.expressions.line,
    );
  }

  search(query: string): Chapter[] {
    const q = query.trim().toLowerCase();
    if (!q) {
      const recommendations = this.searchHub?.recommendations ?? [];
      return this.searchPool
        .filter((item) =>
          recommendations.some((id) => item.chapter.id === `q_hit_${id}`),
        )
        .map((item) => item.chapter);
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    return this.searchPool
      .filter((item) =>
        tokens.every((token) => this.searchable(item.sourceId).includes(token)),
      )
      .slice(0, 8)
      .map((item) => item.chapter);
  }

  get(id: string): Chapter {
    const n = this.chapters.get(id);
    if (!n) throw new Error(`Unknown chapter: ${id}`);
    return n;
  }

  chain(id: string): string[] {
    const seen = new Set<string>(),
      chain: string[] = [];
    let node: Chapter | undefined = this.get(id);
    while (node) {
      if (seen.has(node.id)) throw new Error(`Cycle: ${id}`);
      seen.add(node.id);
      chain.unshift(node.id);
      node = node.parent ? this.get(node.parent) : undefined;
    }
    return chain;
  }

  siblings(id: string, searchResults: readonly string[] = []): Chapter[] {
    const n = this.get(id);
    if (n.hub === this.searchHub?.id && !n.parent) {
      return [
        this.get(this.searchRoot!),
        ...searchResults.map((id) => this.get(id)),
      ];
    }
    return n.parent
      ? this.get(n.parent).children.map((id) => this.get(id))
      : [n];
  }

  document(id: string, presentation: Presentation): ContentDocument {
    this.expressionState(id, presentation);
    return this.content.document(this.mirrorSources.get(id) ?? id, presentation);
  }

  expressionVersion(id: string, presentation: Presentation): number {
    return this.expressionState(id, presentation).version;
  }

  updateExpression(
    id: string,
    presentation: Presentation,
    text: string,
    complete: boolean,
  ): void {
    this.expressionState(id, presentation);
    this.content.publish(this.mirrorSources.get(id) ?? id, presentation, text, complete);
  }
}
