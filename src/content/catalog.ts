import type { Chapter, ContentRow, HubDefinition } from "../core/types.ts";
export class Catalog {
  readonly chapters = new Map<string, Chapter>();
  readonly definitions: readonly HubDefinition[];
  constructor(
    definitions: HubDefinition[],
    rows: Record<string, ContentRow[]>,
  ) {
    this.definitions = definitions;
    const hubs = new Set(definitions.map((h) => h.id));
    if (hubs.size !== definitions.length) throw new Error("Duplicate hub");
    for (const [hub, content] of Object.entries(rows)) {
      if (!hubs.has(hub)) throw new Error(`Unknown hub: ${hub}`);
      for (const [id, name, parent, title, circle, line, refs] of content) {
        if (this.chapters.has(id)) throw new Error(`Duplicate chapter: ${id}`);
        this.chapters.set(id, {
          id,
          name,
          parent,
          title,
          expressions: { circle, line },
          refs: refs.map(([glyph, target]) => ({ glyph, target })),
          children: [],
          hub,
        });
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
      for (const text of Object.values(node.expressions)) {
        for (const match of text.matchAll(/\{[^{}|]+\|([^{}]+)\}/g))
          if (!match[1].startsWith("act:")) this.get(match[1]);
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
  siblings(id: string): Chapter[] {
    const n = this.get(id);
    return n.parent
      ? this.get(n.parent).children.map((id) => this.get(id))
      : [n];
  }
}
