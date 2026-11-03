import type { ContentBuildIssue, StaticReaderInput } from "./core/static-content.ts";
import type { ManifestChapter, Presentation, ReaderDefinition } from "./core/content.ts";
import type { HubDefinition, Theme } from "./core/types.ts";
import { isContentAction } from "./core/content-actions.ts";
import { THEME_OPTIONS } from "./core/palette.ts";
import { parseContent } from "./content/parser.ts";
import { buildSearchEntry } from "./content/search.ts";
export type { ContentBuildIssue, StaticReaderInput, StaticChapter, StaticHub, StaticBody } from "./core/static-content.ts";
export type { ReaderDefinition } from "./core/content.ts";

export class ContentBuildError extends Error {
  readonly issues: readonly ContentBuildIssue[];
  constructor(issues: readonly ContentBuildIssue[]) {
    super(issues.map(issue => `${issue.path}${issue.line ? `:${issue.line}:${issue.column}` : ""}: ${issue.message}`).join("\n"));
    this.name = "ContentBuildError";
    this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })));
  }
}

/** Pure author-data adapter. No DOM, generated identities, storage or runtime state. */
export function buildStaticReader(input: StaticReaderInput): ReaderDefinition {
  const issues: ContentBuildIssue[] = [];
  const issue = (code: ContentBuildIssue["code"], path: string, message: string) => { issues.push({ code, path, message }); };
  const fail = () => { if (issues.length) throw new ContentBuildError(issues); };
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    issue("shape", path, "Expected an object"); return {};
  };
  const array = (value: unknown, path: string): unknown[] => {
    if (Array.isArray(value)) return value;
    issue("shape", path, "Expected an array"); return [];
  };
  const string = (value: unknown, path: string, empty = false): string => {
    if (typeof value === "string" && (empty || value.trim().length > 0)) return value;
    issue("shape", path, empty ? "Expected text" : "Expected non-empty text"); return "";
  };
  const optionalString = (value: unknown, path: string) => value === undefined ? undefined : string(value, path);
  const id = (value: unknown, path: string): string => {
    const text = string(value, path);
    if (text && (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(text) || text.startsWith("q_hit_") || ["constructor", "prototype"].includes(text)))
      issue("id", path, "Use an explicit letter-led ID with letters, digits, _ or -; q_hit_ and object prototype names are reserved");
    return text;
  };
  const enumeration = <T extends string>(value: unknown, values: readonly T[], path: string): T | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === "string" && values.includes(value as T)) return value as T;
    issue("shape", path, `Expected one of: ${values.join(", ")}`); return undefined;
  };
  const finite = (value: unknown, path: string): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    issue("shape", path, "Expected a finite number"); return undefined;
  };
  const authored = object(input, "$"), entry = id(authored.entry, "entry"), title = optionalString(authored.title, "title");
  const hubPaths = new Map<string, string>(), chapterPaths = new Map<string, string>();
  const unique = (map: Map<string, string>, value: string, path: string) => {
    if (map.has(value)) issue("duplicate", `${path}.id`, `Duplicate ID ${value}; first declared at ${map.get(value)}.id`);
    else map.set(value, path);
  };
  const hubs = array(authored.hubs, "hubs").map((value, index) => {
    const path = `hubs[${index}]`, raw = object(value, path), hubId = id(raw.id, `${path}.id`);
    unique(hubPaths, hubId, path);
    let center: { x: number; y: number } | undefined;
    if (raw.center !== undefined) {
      const point = object(raw.center, `${path}.center`);
      const x = finite(point.x, `${path}.center.x`), y = finite(point.y, `${path}.center.y`);
      if (x === undefined || y === undefined) issue("shape", `${path}.center`, "Provide both finite x and y coordinates");
      else center = { x, y };
    }
    return { id: hubId, root: optionalString(raw.root, `${path}.root`), glyph: optionalString(raw.glyph, `${path}.glyph`) ?? hubId[0],
      theme: enumeration(raw.theme, THEME_OPTIONS.map(item => item.value), `${path}.theme`) ?? "parchment" as Theme,
      center, angle: finite(raw.angle, `${path}.angle`) ?? 0,
      morph: enumeration(raw.presentation, ["circle", "line"], `${path}.presentation`) === "line" ? 1 : 0,
      readingLayoutMode: enumeration(raw.readingLayoutMode, ["window", "geometric"], `${path}.readingLayoutMode`) ?? "window",
      kind: enumeration(raw.kind, ["search", "settings"], `${path}.kind`),
      layout: enumeration(raw.layout, ["anchored"], `${path}.layout`),
      parentHub: optionalString(raw.parentHub, `${path}.parentHub`),
      recommendations: raw.recommendations === undefined ? undefined : array(raw.recommendations, `${path}.recommendations`).map((target, i) => string(target, `${path}.recommendations[${i}]`)) };
  });
  if (!hubs.length) issue("shape", "hubs", "At least one hub is required");
  const bodies = new Map<string, { circle: string; line: string }>();
  const bodyPaths = new Map<string, { circle: string; line: string }>();
  const chapters: ManifestChapter[] = array(authored.chapters, "chapters").map((value, index) => {
    const path = `chapters[${index}]`, raw = object(value, path), chapterId = id(raw.id, `${path}.id`);
    unique(chapterPaths, chapterId, path);
    const shared = typeof raw.body === "string", body = shared ? null : object(raw.body, `${path}.body`);
    bodies.set(chapterId, shared ? { circle: raw.body as string, line: raw.body as string }
      : { circle: string(body!.circle, `${path}.body.circle`, true), line: string(body!.line, `${path}.body.line`, true) });
    bodyPaths.set(chapterId, { circle: `${path}.body${shared ? "" : ".circle"}`, line: `${path}.body${shared ? "" : ".line"}` });
    const refs = raw.refs === undefined ? [] : array(raw.refs, `${path}.refs`).map((value, i) => {
      const refPath = `${path}.refs[${i}]`, ref = object(value, refPath);
      return { glyph: string(ref.label, `${refPath}.label`), target: string(ref.target, `${refPath}.target`) };
    });
    let boundaryRoutes: ManifestChapter["boundaryRoutes"];
    if (raw.boundaryRoutes !== undefined) {
      const routes = object(raw.boundaryRoutes, `${path}.boundaryRoutes`);
      const previous = optionalString(routes.previous, `${path}.boundaryRoutes.previous`);
      const next = optionalString(routes.next, `${path}.boundaryRoutes.next`);
      boundaryRoutes = { ...(previous === undefined ? {} : { previous }), ...(next === undefined ? {} : { next }) };
    }
    return { id: chapterId, hub: string(raw.hub, `${path}.hub`), title: string(raw.title, `${path}.title`),
      name: optionalString(raw.name, `${path}.name`) ?? chapterId,
      parent: raw.parent === undefined || raw.parent === null ? null : string(raw.parent, `${path}.parent`), refs, boundaryRoutes, inlineTargets: [] };
  });
  if (!chapters.length) issue("shape", "chapters", "At least one chapter is required");
  fail(); // Shape errors must not turn into incidental graph/parser exceptions.
  const byChapter = new Map(chapters.map(chapter => [chapter.id, chapter]));
  const byHub = new Map(hubs.map(hub => [hub.id, hub]));
  const target = (value: string | undefined, path: string) => {
    if (value !== undefined && !byChapter.has(value)) issue("reference", path, `Unknown chapter target: ${value}`);
  };
  target(entry, "entry");
  for (const kind of ["search", "settings"] as const) {
    const found = hubs.filter(hub => hub.kind === kind);
    for (const hub of found.slice(1)) issue("capability", `${hubPaths.get(hub.id)}.kind`, `Only one ${kind} hub is supported`);
  }
  for (const chapter of chapters) {
    const path = chapterPaths.get(chapter.id)!;
    if (!byHub.has(chapter.hub)) issue("ownership", `${path}.hub`, `Unknown hub: ${chapter.hub}`);
    if (chapter.parent !== null) {
      target(chapter.parent, `${path}.parent`);
      const parent = byChapter.get(chapter.parent);
      if (parent && parent.hub !== chapter.hub) issue("ownership", `${path}.parent`, "A parent must belong to the same hub; use a reference for cross-hub relationships");
    }
    chapter.refs.forEach((ref, i) => target(ref.target, `${path}.refs[${i}].target`));
    for (const [direction, destination] of Object.entries(chapter.boundaryRoutes ?? {})) target(destination, `${path}.boundaryRoutes.${direction}`);
    const texts = bodies.get(chapter.id)!, paths = bodyPaths.get(chapter.id)!;
    const targets = new Set<string>();
    for (const presentation of ["circle", "line"] as const) {
      // A shared string is parsed only once; the resulting targets serve both shapes.
      if (presentation === "line" && paths.circle === paths.line) continue;
      const source = texts[presentation];
      for (const ref of parseContent(source).references) {
        targets.add(ref.target);
        if (byChapter.has(ref.target) || isContentAction(ref.target)) continue;
        const before = source.slice(0, ref.sourceStart), lines = before.split("\n");
        issues.push({ code: "reference", path: paths[presentation], line: lines.length, column: lines.at(-1)!.length + 1,
          message: `Unknown inline chapter or built-in action: ${ref.target}` });
      }
    }
    chapter.inlineTargets = [...targets];
  }
  for (const hub of hubs) {
    const path = hubPaths.get(hub.id)!;
    const roots = chapters.filter(chapter => chapter.hub === hub.id && chapter.parent === null);
    if (hub.root === undefined && roots.length === 1) hub.root = roots[0].id;
    const root = hub.root ? byChapter.get(hub.root) : undefined;
    if (!root || root.hub !== hub.id || root.parent !== null) issue("root", `${path}.root`, "A hub needs one root chapter of its own with no parent");
    for (const other of roots.filter(chapter => chapter.id !== hub.root))
      issue("root", `${chapterPaths.get(other.id)}.parent`, `Disconnected root in hub ${hub.id}; give it a parent or move it to another hub`);
    if (hub.parentHub !== undefined && !byHub.has(hub.parentHub)) issue("reference", `${path}.parentHub`, `Unknown parent hub: ${hub.parentHub}`);
    hub.recommendations?.forEach((value, index) => {
      const refPath = `${path}.recommendations[${index}]`; target(value, refPath);
      if (hub.kind !== "search") issue("capability", refPath, "Recommendations are supported only by the search hub");
      else if (byChapter.get(value)?.hub === hub.id) issue("ownership", refPath, "Search recommendations must refer to chapters outside the search hub");
    });
  }
  // Iterative parent walks detect cycles without recursing through authored depth.
  const cycles = (parents: Map<string, string | null | undefined>, paths: Map<string, string>, property: string) => {
    const done = new Set<string>();
    for (const first of parents.keys()) {
      const walk: string[] = [], seen = new Set<string>(); let current: string | null | undefined = first;
      while (current && parents.has(current) && !done.has(current)) {
        if (seen.has(current)) { issue("cycle", `${paths.get(current)}.${property}`, `Parent cycle: ${[...walk.slice(walk.indexOf(current)), current].join(" -> ")}`); break; }
        seen.add(current); walk.push(current); current = parents.get(current);
      }
      for (const visited of walk) done.add(visited);
    }
  };
  cycles(new Map(chapters.map(chapter => [chapter.id, chapter.parent])), chapterPaths, "parent");
  cycles(new Map(hubs.map(hub => [hub.id, hub.parentHub])), hubPaths, "parentHub");
  fail();
  const sorted = [...byHub.keys()].sort(), columns = Math.ceil(Math.sqrt(hubs.length));
  const definitions: HubDefinition[] = hubs.map(hub => {
    const index = sorted.indexOf(hub.id);
    return { ...hub, root: hub.root!, layout: hub.layout ?? (hub.kind === "search" ? "anchored" : undefined),
      center: hub.center ?? { x: index % columns * 1800, y: Math.floor(index / columns) * 1600 },
      recommendations: hub.recommendations ? [...hub.recommendations] : undefined };
  });
  return { title, entry, manifest: { format: 1, definitions, chapters,
    searchIndex: chapters.map(chapter => buildSearchEntry({ ...chapter, ...bodies.get(chapter.id)! })) },
    source: Object.freeze({ async *open(chapterId: string, presentation: Presentation, signal: AbortSignal) {
      if (signal.aborted) return;
      const expressions = bodies.get(chapterId);
      if (!expressions) throw new Error(`Unknown static chapter: ${chapterId}`);
      if (presentation !== "circle" && presentation !== "line") throw new Error(`Unknown presentation: ${presentation}`);
      yield { type: "replace" as const, text: expressions[presentation] };
    } }) };
}
