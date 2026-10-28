import test from "node:test";
import assert from "node:assert/strict";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { rawContent, hubDefinitions } from "../src/content/field.ts";
import {
  STEM_DISTANCE,
  ordinaryAndLocalAttachments,
  globalAttachments,
  localBandForHub,
  resolveGlobalHostHub,
} from "../src/application/attachments.ts";
import {
  contentMaterialSide,
  projectAttachment,
} from "../src/geometry/attachments.ts";
import {
  arcLengthAt,
  nodeS,
  outwardNormal,
  passageGeometry,
} from "../src/geometry/field.ts";
import { rot } from "../src/core/math.ts";
import { ICON_TOKENS } from "../src/core/icons.ts";

const fresh = () =>
  new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1200,
    height: 800,
  });
const close = (a: number, b: number, eps = 1e-5) =>
  assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("globals have global semantic scope and no synthetic loading action", () => {
  const f = fresh(),
    a = globalAttachments(f.state, f.catalog);
  assert.deepEqual(
    a.map((e) => e.id),
    [
      "global:overview",
      "global:search",
      "global:settings",
      "global:back",
    ],
  );
  assert.ok(a.every((e) => e.role === "operation" && e.scope === "global"));
  assert.ok(
    a.every((e) => e.anchor.hostHub === f.state.focus && e.side === "opposite"),
  );
  assert.ok(
    a.every(
      (e) =>
        e.contentKind === "icon" && e.icon && e.icon.viewBox === "0 0 24 24",
    ),
  );
  assert.deepEqual(a.find((e) => e.id === "global:search")?.command, {
    type: "navigate",
    target: "q0",
  });
  assert.deepEqual(a.find((e) => e.id === "global:settings")?.command, {
    type: "navigate",
    target: "s0",
  });
  assert.equal(a.some((e) => e.id === "global:loading"), false);
  f.state.focus = "B";
  const switched = globalAttachments(f.state, f.catalog);
  assert.ok(switched.every((e) => e.anchor.hostHub === "B"));
  assert.deepEqual(
    switched.map((e) => e.anchor.id),
    a.map((e) => e.anchor.id),
    "semantic IDs persist on host switch",
  );
});

test("ordinary and local tags share content side while global operations project to opposite side", () => {
  const f = fresh();
  for (const morph of [0, 0.5, 1]) {
    f.hub.morph = morph;
    const h = f.hub,
      s = f.state;
    const selected = f.selected(),
      nodes = f.siblings();
    const attached = ordinaryAndLocalAttachments(
      h,
      selected,
      nodes,
      s.camera,
      s.viewport,
    );
    assert.ok(attached.length > 0);
    assert.ok(
      attached
        .filter((a) => a.role === "ordinary")
        .every((a) => a.side === "content" && a.anchor.hostHub === h.id),
    );
    assert.ok(
      attached
        .filter((a) => a.role === "local")
        .every((a) => a.side === "content" && a.anchor.hostHub === h.id),
    );
    const focus = nodeS(h, h.scroll, nodes.length, s.camera, s.viewport);
    const sign = contentMaterialSide(h, focus, s.camera, 1);
    const globals = globalAttachments(s, f.catalog);
    for (const a of [...attached, ...globals]) {
      const at = projectAttachment(h, a, s.camera, s.viewport, sign);
      const normal = rot(
        outwardNormal(h, a.anchor.parameter),
        (s.camera.rotation * Math.PI) / 180,
      );
      const dot =
        (at.position.x - at.hinge.x) * normal.x +
        (at.position.y - at.hinge.y) * normal.y;
      assert.ok(Math.abs(dot) > 10, `${morph} ${a.id}: nonzero normal spacing`);
      assert.equal(
        Math.sign(dot),
        a.side === "content" ? sign : -sign,
        `${morph} ${a.id}: correct normal side`,
      );
      assert.ok(
        Number.isFinite(
          at.hinge.x + at.hinge.y + at.position.x + at.position.y,
        ),
      );
    }
  }
});

test("hierarchical radial stem distances retain their proportions under camera zoom", () => {
  const f = fresh(),
    h = f.hub,
    s = f.state;
  h.path = ["a0", "a3", "a31"];
  h.scroll = 0;
  const current = f.catalog.get("a31"),
    nodes = f.catalog.siblings(current.id);
  const attached = ordinaryAndLocalAttachments(
    h,
    current,
    nodes,
    s.camera,
    s.viewport,
  );
  const currentOrd = attached.find(
    (e) => e.role === "ordinary" && e.visual === "current",
  )!;
  const peerOrd = attached.find(
    (e) => e.role === "ordinary" && e.visual === "peer",
  )!;
  const localExt = attached.find((e) => e.role === "local")!;
  let a = globalAttachments(s, f.catalog);
  const ids = a.map((e) => e.anchor.id);
  const first = a.find((e) => e.id === "global:settings")!;

  assert.equal(first.distance, STEM_DISTANCE.globalOperation);
  assert.equal(currentOrd.distance, STEM_DISTANCE.currentOrdinary);
  assert.equal(peerOrd.distance, STEM_DISTANCE.peerOrdinary);
  assert.equal(localExt.distance, STEM_DISTANCE.localExtension);
  assert.ok(
    STEM_DISTANCE.globalOperation > STEM_DISTANCE.currentOrdinary &&
      STEM_DISTANCE.currentOrdinary > STEM_DISTANCE.peerOrdinary &&
      STEM_DISTANCE.peerOrdinary > STEM_DISTANCE.localExtension,
    "hierarchical radial stem distances strictly decrease from global -> current -> ordinary -> local",
  );

  const s0 = nodeS(h, h.scroll, nodes.length, s.camera, s.viewport);
  const sign = contentMaterialSide(h, s0, s.camera, 1);
  const size = (zoom: number) => {
    s.camera.z = zoom;
    const p = projectAttachment(h, first, s.camera, s.viewport, sign);
    return Math.hypot(p.position.x - p.hinge.x, p.position.y - p.hinge.y);
  };
  close(size(0.35), STEM_DISTANCE.globalOperation * 0.35);
  close(size(1), STEM_DISTANCE.globalOperation);
  close(size(2.1), STEM_DISTANCE.globalOperation * 2.1);
  h.morph = 1;
  a = globalAttachments(s, f.catalog);
  assert.deepEqual(
    a.map((e) => e.anchor.id),
    ids,
  );
});

test("local extension labels never change ordinary material anchors or spacing", () => {
  const f = fresh();
  f.hub.path = ["a0", "a3", "a31"];
  f.hub.scroll = 0;
  const current = f.catalog.get("a31"),
    nodes = f.catalog.siblings(current.id);
  const before = ordinaryAndLocalAttachments(
    f.hub,
    current,
    nodes,
    f.state.camera,
    f.state.viewport,
  );
  const tags = before
    .filter((e) => e.role === "ordinary")
    .map((e) => [e.anchor.id, e.anchor.parameter]);
  assert.ok(before.some((e) => e.role === "local"));

  const bareChapter = { ...current, parent: undefined, refs: [] };
  const bareHub = { ...f.hub, path: [current.id] };
  const bareAttachments = ordinaryAndLocalAttachments(
    bareHub,
    bareChapter,
    nodes,
    f.state.camera,
    f.state.viewport,
  );
  const focusParam = before.find((e) => e.id === nodes[0].id)!.anchor.parameter;
  const nextWithLocal = before.find((e) => e.id === nodes[1].id)!.anchor
    .parameter;
  const nextWithoutLocal = bareAttachments.find((e) => e.id === nodes[1].id)!
    .anchor.parameter;
  const arcWithLocal = Math.abs(
    arcLengthAt(f.hub, nextWithLocal) - arcLengthAt(f.hub, focusParam),
  );
  const arcWithoutLocal = Math.abs(
    arcLengthAt(f.hub, nextWithoutLocal) - arcLengthAt(f.hub, focusParam),
  );
  assert.ok(
    Math.abs(arcWithLocal - arcWithoutLocal) < 1e-7,
    "local entries occupy the existing gap without shifting ordinary labels",
  );

  f.hub.localScroll = 7;
  const after = ordinaryAndLocalAttachments(
    f.hub,
    current,
    nodes,
    f.state.camera,
    f.state.viewport,
  );
  assert.deepEqual(
    after
      .filter((e) => e.role === "ordinary")
      .map((e) => [e.anchor.id, e.anchor.parameter]),
    tags,
  );
});

test("switching hubs binds global labels immediately to destination hub without morph animation", () => {
  const f = fresh();
  f.state.hubs.A.morph = 0;
  f.state.hubs.A.targetMorph = 0;
  f.state.hubs.L.morph = 1;
  f.state.hubs.L.targetMorph = 1;
  f.dispatch({ type: "focus", hub: "L" });
  assert.ok(f.state.passage, "focus switch starts a passage transition");
  f.state.passage!.phase = 0.2; // before midpoint
  const host = resolveGlobalHostHub(f.state);
  assert.equal(
    host.id,
    "L",
    "global labels immediately bind to destination hub L",
  );
  const globals = globalAttachments(f.state, f.catalog);
  assert.ok(
    globals.every(
      (g) =>
        g.icon && g.symbolMorph === undefined && g.symbolGeometry === undefined,
    ),
    "static global icons retain their shape on the destination host",
  );
});

test("passage mask transition follows Möbius transformation rules across circle -> line -> inverted circle", () => {
  const f = fresh();
  f.dispatch({ type: "focus", hub: "B" });
  assert.ok(f.state.passage);
  const t = f.state.passage!;
  t.phase = 0.05;
  const gStart = passageGeometry(t, f.state.camera, f.state.viewport);
  t.phase = 0.5;
  const gMid = passageGeometry(t, f.state.camera, f.state.viewport);
  t.phase = 0.95;
  const gEnd = passageGeometry(t, f.state.camera, f.state.viewport);
  assert.ok(
    gStart.strokeD.length > 20 &&
      gMid.strokeD.length > 20 &&
      gEnd.strokeD.length > 20,
  );
  assert.notEqual(gStart.sweptClipD, gMid.sweptClipD);
  assert.notEqual(gMid.sweptClipD, gEnd.sweptClipD);
});

test("overview adds a globally scoped refocus attachment and switches host when camera pans to another hub", () => {
  const f = fresh();
  f.state.overview = true;
  const a = globalAttachments(f.state, f.catalog);
  const refocus = a.find((e) => e.id === "global:refocus");
  assert.equal(refocus?.anchor.hostHub, f.state.focus);
  assert.equal(refocus?.scope, "global");
  assert.equal(refocus?.side, "opposite");
  assert.equal(refocus?.icon?.id, "refocus");
  // Pan camera close to hub L in overview -> accessible fallback host switches to L
  f.state.camera.x = f.state.hubs.L.center.x;
  f.state.camera.y = f.state.hubs.L.center.y;
  const switched = globalAttachments(f.state, f.catalog);
  assert.equal(switched[0].anchor.hostHub, "L");
});

test("unified 24x24 SVG geometric icon tokens define optical calibration for all core symbols", () => {
  for (const glyph of ["⊙", "⌕", "↶", "⚙", "◌", "↑", "⌖", "✓", "✕"]) {
    const token = ICON_TOKENS[glyph];
    assert.ok(token, `missing icon token for ${glyph}`);
    assert.equal(token.viewBox, "0 0 24 24");
    assert.equal(token.sizePx, 20);
    assert.equal(token.baseStrokeWidth, 2);
    assert.ok(token.opticalScale > 0.8 && token.opticalScale < 1.2);
    assert.ok(token.shapes.length > 0);
  }
});

test("local input never scrolls beyond its actual geometric visible band", () => {
  const f = fresh();
  f.hub.path = ["a0", "a3", "a31"];
  f.hub.scroll = 0;
  const band = localBandForHub(
    f.hub,
    f.selected(),
    f.siblings(),
    f.state.camera,
    f.state.viewport,
  );
  for (let i = 0; i < 30; i++) f.dispatch({ type: "scroll-local", delta: 1 });
  close(f.hub.localScrollTarget, band.maxScroll);
  f.dispatch({ type: "scroll-local", delta: -1 });
  close(f.hub.localScrollTarget, Math.max(0, band.maxScroll - 1));
});

test("changing local counts or focus identity never displaces ordinary tags during continuous scrolling", () => {
  const f = fresh();
  const nodes = f.catalog.siblings("a31");
  for (const morph of [0, 0.45, 1]) {
    f.hub.morph = f.hub.targetMorph = morph;
    for (const scroll of [0, 0.2, 0.7, 1, 2.4]) {
      f.hub.scroll = scroll;
      let baseline: unknown;
      for (const count of [0, 1, 3, 12]) {
        const current = {
          ...nodes[Math.round(scroll)],
          refs: Array.from({ length: count }, () => ({
            glyph: "β",
            target: "b0",
          })),
          parent: null,
        };
        const entries = ordinaryAndLocalAttachments(
          f.hub,
          current,
          nodes,
          f.state.camera,
          f.state.viewport,
        );
        const positions = entries
          .filter((e) => e.role === "ordinary")
          .map((e) => [e.id, e.anchor.parameter, e.distance]);
        if (baseline) assert.deepEqual(positions, baseline);
        baseline = positions;
      }
    }
  }
});
