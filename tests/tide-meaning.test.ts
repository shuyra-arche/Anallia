import test from "node:test";
import assert from "node:assert/strict";
import { createTideAtlas } from "../src/examples/tide-atlas.ts";
import { Catalog } from "../src/content/catalog.ts";
import { Field } from "../src/application/field.ts";
import { ordinaryAndLocalAttachments } from "../src/application/attachments.ts";
import { buildSceneFrame } from "../src/geometry/scene-frame.ts";
import { frameFor } from "../src/geometry/field.ts";
import { evaluateHubCurve } from "../src/geometry/graphics.ts";
import { hubInk, PAPER, THEME_OPTIONS } from "../src/core/palette.ts";
import { projectTideFrame, tideLenses } from "../src/demos/tide-hub.ts";
import { TideLabelMotion } from "../src/demos/tide-label-motion.ts";
import type { FieldState } from "../src/core/types.ts";

function fresh() {
  const definition = createTideAtlas(),
    catalog = new Catalog(definition.manifest.definitions, definition.manifest),
    field = new Field(catalog, { width: 1366, height: 844 }, true);
  field.state.loading = false;
  field.state.camera = frameFor(
    field.hub,
    0,
    1,
    field.state.camera,
    field.state.viewport,
  );
  return { definition, catalog, field };
}
function build(
  state: FieldState,
  catalog: Catalog,
  renderer: "svg" | "webgl" = "svg",
  feedback: Map<string, any> = new Map(),
) {
  const h = state.hubs[state.focus],
    chapter = catalog.get(h.path.at(-1)!);
  const entries = ordinaryAndLocalAttachments(
    h,
    chapter,
    catalog.siblings(chapter.id, state.searchResults),
    state.camera,
    state.viewport,
  );
  return buildSceneFrame(state, catalog, {
    renderer,
    revision: 1,
    relationColor: "#888888",
    focusedEntries: entries,
    locals: entries
      .filter((x) => x.role === "local")
      .map((attachment) => ({
        attachment,
        visibility: 1,
        phase: "settled",
        pose: null,
      })),
    feedback,
    hoveredTarget: null,
  }).frame;
}
test("hub curves and destination labels share owning hub colors in both renderers and every feedback state", () => {
  const { catalog, field } = fresh();
  const svg = build(field.state, catalog),
    gpu = build(field.state, catalog, "webgl");
  assert.deepEqual(
    svg.labels.map((x) => x.color),
    gpu.labels.map((x) => x.color),
  );
  const reference = svg.labels.find((x) => x.linkTarget === "letter-entry")!;
  assert.ok(reference);
  assert.equal(reference.color?.hub, "LETTER");
  assert.equal(reference.color?.ink, hubInk("ivory", "light"));
  const current = svg.labels.find((x) => x.visual === "current")!;
  assert.equal(current.color?.hub, "SHORE");
  const curve = evaluateHubCurve(
    field.hub,
    field.state.camera,
    field.state.viewport,
  );
  assert.equal(curve.kind, "circle");
  assert.ok(
    svg.layers
      .find((x) => x.id === "hubs")!
      .primitives.some((x) => x.stroke === current.color?.ink),
  );
  for (const interaction of [
    { hover: true },
    { focus: true },
    { press: true },
  ]) {
    const frame = build(
      field.state,
      catalog,
      "svg",
      new Map([[current.id, interaction]]),
    );
    const label = frame.labels.find((x) => x.id === current.id)!;
    assert.equal(label.color?.ink, current.color?.ink);
    assert.deepEqual(label.color, current.color);
    assert.deepEqual(label.interaction, interaction);
  }
  field.state.theme = "dark";
  assert.equal(
    build(field.state, catalog).labels.find((x) => x.id === current.id)!.color
      ?.ink,
    hubInk("light", "dark"),
  );
  catalog.destroy();
});

test("circle relationships and line routes keep the same semantic IDs without mutating field or numeric input", () => {
  const { catalog, field } = fresh();
  const base = build(field.state, catalog),
    before = JSON.stringify([field.state, base]);
  const circle = projectTideFrame(base, field.state, catalog);
  assert.equal(JSON.stringify([field.state, base]), before);
  const chapters = circle.labels.filter((x) => x.id.includes("tide:chapter:"));
  assert.equal(chapters.length, 5);
  assert.ok(
    circle.layers.find((x) => x.id === "relations")!.primitives.length >
      base.layers.find((x) => x.id === "relations")!.primitives.length,
  );
  field.hub.morph = field.hub.targetMorph = 1;
  field.state.camera = frameFor(
    field.hub,
    0,
    1,
    field.state.camera,
    field.state.viewport,
  );
  const line = projectTideFrame(
    build(field.state, catalog),
    field.state,
    catalog,
  );
  assert.deepEqual(
    line.labels.filter((x) => x.id.includes("tide:chapter:")).map((x) => x.id),
    chapters.map((x) => x.id),
  );
  assert.deepEqual(
    line.labels
      .filter((x) => x.id.includes("tide:chapter:"))
      .map((x) => x.glyph),
    ["1 岸", "2 潮", "3 壳", "4 拾", "5 返"],
  );
  assert.notDeepEqual(tideLenses.SHORE.circle, tideLenses.SHORE.line);
  field.state.viewport = { width: 320, height: 568 };
  field.state.camera = frameFor(
    field.hub,
    0,
    1,
    field.state.camera,
    field.state.viewport,
  );
  const phone = projectTideFrame(
    build(field.state, catalog),
    field.state,
    catalog,
  );
  assert.ok(phone.labels.some((x) => x.id === "SHORE:tide:chapter:shore-tide"));
  assert.ok(phone.labels.every((x) => !x.id.includes("global:")));
  field.state.overview = true;
  const overview = projectTideFrame(
    build(field.state, catalog),
    field.state,
    catalog,
  );
  assert.equal(overview.labels.length, 1);
  assert.ok(
    overview.labels.every((label) => label.color?.hub === field.state.focus),
  );
  assert.ok(overview.labels.every((x) => x.command.type === "focus"));
  assert.ok(
    overview.labels.every((x) =>
      overview.hitRegions.some((h) => h.id === x.id),
    ),
  );
  catalog.destroy();
});

function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return rgb.reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}
test("hub-derived small text retains contrast on all paper palettes, with transparent label backgrounds", () => {
  for (const owner of THEME_OPTIONS)
    for (const paper of THEME_OPTIONS) {
      const ink = hubInk(owner.value, paper.value),
        background = PAPER[paper.value];
      const [low, high] = [luminance(ink), luminance(background)].sort(
        (a, b) => a - b,
      );
      assert.ok(
        (high + 0.05) / (low + 0.05) >= 4.5,
        `${owner.value} on ${paper.value}`,
      );
    }
});

test("grandchildren branch from their parent and morph keeps every chapter identity in motion", () => {
  const { catalog, field } = fresh();
  field.setSystemReducedMotion(false);
  const motion = new TideLabelMotion(catalog);
  let frame = motion.project(
    build(field.state, catalog),
    field.state,
    new Map(),
  );
  const root = frame.labels.find(
    (l) => l.id === "SHORE:tide:chapter:shore-entry",
  )!;
  const parent = frame.labels.find(
    (l) => l.id === "SHORE:tide:chapter:shore-tide",
  )!;
  const child = frame.labels.find(
    (l) => l.id === "SHORE:tide:chapter:shell-back",
  )!;
  const distance = (a: typeof root, b: typeof root) =>
    Math.hypot(
      a.layout.position.x - b.layout.position.x,
      a.layout.position.y - b.layout.position.y,
    );
  assert.ok(distance(child, parent) < distance(child, root));
  const ids = frame.labels
    .filter((l) => l.id.includes("tide:chapter:"))
    .map((l) => l.id);
  field.dispatch({ type: "morph" });
  let last = frame;
  for (let now = 20; now <= 1200; now += 20) {
    field.update(now, 20);
    frame = motion.project(build(field.state, catalog), field.state, new Map());
    for (const id of ids) {
      const a = last.labels.find((l) => l.id === id)!,
        b = frame.labels.find((l) => l.id === id)!;
      assert.ok(b, id + " must survive the morph");
      assert.ok(distance(a, b) < 35, id + " must move continuously");
    }
    last = frame;
  }
  assert.equal(motion.isAnimating, false);
  motion.clear();
  catalog.destroy();
});

test("departing compact leaves cannot execute a new context's relative command", () => {
  const { catalog, field } = fresh();
  field.setSystemReducedMotion(false);
  field.state.viewport = { width: 390, height: 844 };
  field.state.camera = frameFor(
    field.hub,
    0,
    1,
    field.state.camera,
    field.state.viewport,
  );
  const motion = new TideLabelMotion(catalog);
  motion.project(build(field.state, catalog), field.state, new Map());
  field.dispatch({ type: "navigate", target: "shore-tide" });
  for (let now = 20; now <= 1000; now += 20) {
    field.update(now, 20);
    const frame = motion.project(
      build(field.state, catalog),
      field.state,
      new Map(),
    );
    for (const leaf of frame.labels.filter((l) =>
      l.id.includes("tide:chapter:"),
    )) {
      if (leaf.command.type === "navigate")
        assert.equal(leaf.command.target, leaf.id.split("tide:chapter:")[1]);
      if (leaf.page && !leaf.page.interactive)
        assert.equal(leaf.interactive, false);
    }
  }
  field.dispatch({ type: "step", delta: 1 });
  const start = motion.project(
    build(field.state, catalog),
    field.state,
    new Map(),
  );
  assert.ok(
    start.labels.some((l) => l.id === "SHORE:shore-tide" && l.opacity > 0.98),
    "old ordinary anchor must remain visible at the start of sibling travel",
  );
  const outgoing = start.labels.find(
    (l) => l.id === "SHORE:tide:chapter:shell-back",
  );
  assert.ok(outgoing);
  assert.equal(outgoing.interactive, false);
  field.state.settings.reducedMotion = true;
  motion.project(build(field.state, catalog), field.state, new Map());
  assert.equal(motion.isAnimating, false);
  motion.clear();
  catalog.destroy();
});

test("focus handoff drops old hub labels and overview retains only its owner", () => {
  const { catalog, field } = fresh(),
    motion = new TideLabelMotion(catalog);
  motion.project(build(field.state, catalog), field.state, new Map());
  field.dispatch({ type: "navigate", target: "letter-entry" });
  for (let now = 20; now < 1600; now += 20) {
    field.update(now, 20);
    const frame = motion.project(
      build(field.state, catalog),
      field.state,
      new Map(),
    );
    assert.ok(frame.labels.every((l) => l.color?.hub === field.state.focus));
  }
  field.dispatch({ type: "overview" });
  for (let now = 1600; now < 2600; now += 20) field.update(now, 20);
  const frame = motion.project(
    build(field.state, catalog),
    field.state,
    new Map(),
  );
  assert.ok(frame.labels.every((l) => l.color?.hub === field.state.focus));
  assert.ok(
    frame.layers
      .find((l) => l.id === "hubs")!
      .primitives.every((p) => p.type !== "text"),
  );
  motion.clear();
  catalog.destroy();
});
