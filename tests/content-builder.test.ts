import test from "node:test";
import assert from "node:assert/strict";
import { buildStaticReader, ContentBuildError, type StaticReaderInput } from "../src/content-builder.ts";
import { Catalog } from "../src/content/catalog.ts";
import { parseContent } from "../src/content/parser.ts";
import { captureSessionAnchor, resolveSessionAnchor } from "../src/core/reader-snapshot.ts";
import { createFieldNotebook, createStaticFieldNotebook, notebookRows } from "../src/examples/field-notebook.ts";

const input = (): StaticReaderInput => ({
  title: "Small reader", entry: "start",
  hubs: [{ id: "NOTES" }, { id: "FIND", kind: "search", recommendations: ["detail"] }],
  chapters: [
    { id: "start", hub: "NOTES", title: "开始", body: "读{细节|detail}。", refs: [{ label: "→", target: "detail" }] },
    { id: "detail", hub: "NOTES", parent: "start", title: "细节", body: { circle: "圆态的独有词。", line: "线态的独有词。" } },
    { id: "find", hub: "FIND", title: "查找", body: "" },
  ],
});
async function text(definition: ReturnType<typeof buildStaticReader>, id: string, shape: "circle" | "line") {
  const patches = [];
  for await (const patch of definition.source.open(id, shape, new AbortController().signal)) patches.push(patch);
  return patches;
}
function invalid(value: unknown, code: string, path: string) {
  assert.throws(() => buildStaticReader(value as StaticReaderInput), error => {
    assert.ok(error instanceof ContentBuildError);
    assert.ok(error.issues.some(issue => issue.code === code && issue.path === path), JSON.stringify(error.issues));
    assert.ok(Object.isFrozen(error.issues) && Object.isFrozen(error.issues[0]));
    assert.match(error.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return true;
  });
}

test("minimal author data produces a runtime-compatible manifest, full search index and static source", async () => {
  const definition = buildStaticReader(input());
  const catalog = new Catalog(definition.manifest.definitions, definition.manifest);
  assert.deepEqual(catalog.chain("detail"), ["start", "detail"]);
  assert.equal(catalog.searchRoot, "find");
  for (const term of ["细节", "圆态的独有词", "线态的独有词"])
    assert.ok(catalog.search(term).some(chapter => chapter.id === "q_hit_detail"));
  assert.equal(catalog.search("")[0].id, "q_hit_detail");
  assert.deepEqual(await text(definition, "start", "circle"), [{ type: "replace", text: "读{细节|detail}。" }]);
  assert.deepEqual(await text(definition, "start", "line"), await text(definition, "start", "circle"));
  assert.equal((await text(definition, "detail", "line"))[0].text, "线态的独有词。");
  assert.equal(definition.manifest.definitions[0].theme, "parchment");
  assert.equal(definition.manifest.definitions[1].layout, "anchored");
  catalog.destroy();
});

test("IDs and default geometry survive input reordering; sibling order alone follows the author", () => {
  const authored = input(), before = buildStaticReader(authored);
  const after = buildStaticReader({ ...authored, hubs: [...authored.hubs].reverse(), chapters: [...authored.chapters].reverse() });
  const order = (definition: typeof before) => [...definition.manifest.definitions].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(order(before), order(after));
  assert.deepEqual(before.manifest.chapters.map(c => c.id).sort(), after.manifest.chapters.map(c => c.id).sort());
  const withSibling = buildStaticReader({ ...authored, chapters: [...authored.chapters, { id: "other", hub: "NOTES", title: "其他", parent: "start", body: "另一页" }] });
  const catalog = new Catalog(withSibling.manifest.definitions, withSibling.manifest);
  assert.deepEqual(catalog.get("start").children, ["detail", "other"]);
  catalog.destroy();
});

test("geometry and capability overrides are copied; later author mutations cannot change built content", async () => {
  const authored: any = input();
  Object.assign(authored.hubs[0], { root: "start", glyph: "记", center: { x: 1234, y: -900 }, angle: 30, presentation: "line", theme: "celadon", readingLayoutMode: "geometric" });
  const definition = buildStaticReader(authored), hub = definition.manifest.definitions[0];
  authored.hubs[0].center.x = 0; authored.chapters[0].refs[0].target = "gone";
  authored.chapters[1].body.line = "changed"; authored.hubs[1].recommendations.push("gone");
  assert.deepEqual(hub.center, { x: 1234, y: -900 });
  assert.equal(hub.morph, 1); assert.equal(hub.theme, "celadon"); assert.equal(hub.readingLayoutMode, "geometric");
  assert.equal(definition.manifest.chapters[0].refs[0].target, "detail");
  assert.deepEqual(definition.manifest.definitions[1].recommendations, ["detail"]);
  assert.equal((await text(definition, "detail", "line"))[0].text, "线态的独有词。");
});

test("static sources abort without publishing and reject unknown content; streams remain separate", async () => {
  const definition = buildStaticReader(input()), abort = new AbortController(); abort.abort();
  const received = [];
  for await (const patch of definition.source.open("start", "circle", abort.signal)) received.push(patch);
  assert.deepEqual(received, []);
  await assert.rejects(() => text(definition, "missing", "circle"), /Unknown static chapter/);
  await assert.rejects(() => text(definition, "start", "unknown" as any), /Unknown presentation/);
  const generator = definition.source.open("start", "circle", new AbortController().signal)[Symbol.asyncIterator]();
  assert.equal((await generator.next()).value.type, "replace");
  assert.equal((await generator.next()).done, true);
});

test("duplicates, reserved/generated IDs and malformed bodies have exact author paths", () => {
  const authored = input();
  invalid({ ...authored, hubs: [...authored.hubs, authored.hubs[0]] }, "duplicate", "hubs[2].id");
  invalid({ ...authored, chapters: [...authored.chapters, authored.chapters[0]] }, "duplicate", "chapters[3].id");
  for (const id of ["q_hit_fake", "act:pulse", "bad id", "constructor"])
    invalid({ ...authored, chapters: [{ ...authored.chapters[0], id }, ...authored.chapters.slice(1)] }, "id", "chapters[0].id");
  invalid({ ...authored, chapters: [{ ...authored.chapters[0], body: { circle: "only" } }, ...authored.chapters.slice(1)] }, "shape", "chapters[0].body.line");
  invalid(null, "shape", "$");
  invalid({ ...authored, hubs: [{ id: "NOTES", center: { x: NaN, y: 0 } }] }, "shape", "hubs[0].center.x");
});

test("bad entry, hierarchy ownership, root selection, graph links and duplicate utilities fail before mounting", () => {
  const authored = input();
  invalid({ ...authored, entry: "absent" }, "reference", "entry");
  invalid({ ...authored, chapters: [{ ...authored.chapters[0], hub: "absent" }, ...authored.chapters.slice(1)] }, "ownership", "chapters[0].hub");
  invalid({ ...authored, chapters: [authored.chapters[0], { ...authored.chapters[1], parent: "find" }, authored.chapters[2]] }, "ownership", "chapters[1].parent");
  invalid({ ...authored, hubs: [{ ...authored.hubs[0], root: "find" }, authored.hubs[1]] }, "root", "hubs[0].root");
  invalid({ ...authored, chapters: [...authored.chapters, { id: "extra", title: "孤立", hub: "NOTES", body: "" }] }, "root", "hubs[0].root");
  invalid({ ...authored, chapters: [{ ...authored.chapters[0], refs: [{ label: "x", target: "missing" }] }, ...authored.chapters.slice(1)] }, "reference", "chapters[0].refs[0].target");
  invalid({ ...authored, chapters: [{ ...authored.chapters[0], boundaryRoutes: { next: "missing" } }, ...authored.chapters.slice(1)] }, "reference", "chapters[0].boundaryRoutes.next");
  invalid({ ...authored, hubs: [{ ...authored.hubs[0], kind: "search" }, authored.hubs[1]] }, "capability", "hubs[1].kind");
  invalid({ ...authored, hubs: [authored.hubs[0], { ...authored.hubs[1], recommendations: ["find"] }] }, "ownership", "hubs[1].recommendations[0]");
});

test("chapter and hub parent cycles fail, but reciprocal navigation references remain valid", () => {
  const authored = input();
  invalid({ ...authored, chapters: [{ ...authored.chapters[0], parent: "detail" }, ...authored.chapters.slice(1)] }, "cycle", "chapters[0].parent");
  invalid({ ...authored, hubs: [{ ...authored.hubs[0], parentHub: "FIND" }, { ...authored.hubs[1], parentHub: "NOTES" }] }, "cycle", "hubs[0].parentHub");
  const definition = buildStaticReader({ ...authored, chapters: [authored.chapters[0], { ...authored.chapters[1], refs: [{ label: "返回", target: "start" }] }, authored.chapters[2]] });
  assert.equal(definition.manifest.chapters[1].refs[0].target, "start");
});

test("one-sided boundary routes omit absent targets and remain compatible with Catalog", () => {
  const authored = input();
  for (const boundaryRoutes of [{ next: "find" }, { previous: "start" }, {}]) {
    const definition = buildStaticReader({ ...authored, chapters: [authored.chapters[0], { ...authored.chapters[1], boundaryRoutes }, authored.chapters[2]] });
    const catalog = new Catalog(definition.manifest.definitions, definition.manifest);
    assert.deepEqual(catalog.boundaryRoutes("detail"), boundaryRoutes);
    catalog.destroy();
  }
});

test("body diagnostics use the runtime parser and point to expression, line and column", () => {
  const authored = input();
  try {
    buildStaticReader({ ...authored, chapters: [{ ...authored.chapters[0], body: { circle: "段落。\n\n读{这里|missing}。", line: "[vlist]\n键 :: {动作|act:not_real}" } }, ...authored.chapters.slice(1)] });
    assert.fail("must reject missing targets");
  } catch (error) {
    assert.ok(error instanceof ContentBuildError);
    assert.deepEqual(error.issues.map(({ path, line, column }) => ({ path, line, column })), [
      { path: "chapters[0].body.circle", line: 3, column: 2 },
      { path: "chapters[0].body.line", line: 2, column: 6 },
    ]);
  }
  const definition = buildStaticReader({ ...authored, chapters: [{ ...authored.chapters[0], body: "{声音|act:toggle_sound}\n\n普通 { 字符。" }, ...authored.chapters.slice(1)] });
  assert.deepEqual(definition.manifest.chapters[0].inlineTargets, ["act:toggle_sound"]);
  invalid({ ...authored, chapters: [{ ...authored.chapters[0], refs: [{ label: "声音", target: "act:toggle_sound" }] }, ...authored.chapters.slice(1)] }, "reference", "chapters[0].refs[0].target");
});

test("static notebook retains authored IDs, deep hierarchy, index and reliable session anchors", async () => {
  const definition = createStaticFieldNotebook(), streamed = createFieldNotebook();
  assert.deepEqual(definition.manifest, streamed.manifest);
  const catalog = new Catalog(definition.manifest.definitions, definition.manifest);
  assert.equal(catalog.chain("obs-mark").length, 5);
  assert.ok(catalog.search("砖缝").some(chapter => catalog.sourceChapterId(chapter.id) === "obs-mark"));
  for (const rows of Object.values(notebookRows)) for (const [id, , , , circle, line] of rows) {
    assert.equal((await text(definition, id, "circle"))[0].text, circle);
    assert.equal((await text(definition, id, "line"))[0].text, line);
  }
  const source = (await text(definition, "log-day", "line"))[0].text;
  const document = parseContent(source), offset = source.indexOf("记录 12");
  assert.ok(offset > 100);
  const saved = captureSessionAnchor(document, offset)!;
  assert.equal(resolveSessionAnchor(saved, parseContent("新增的说明。\n\n" + source)), offset + "新增的说明。\n\n".length);
  catalog.destroy();
});
