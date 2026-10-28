import test from "node:test";
import assert from "node:assert/strict";
import {
  SYMBOL_KINDS,
  SYMBOL_OPTICAL_TOKENS,
  evaluateSymbol,
  measureSymbolBounds,
} from "../src/core/symbol-morph.ts";
import type { SymbolKind } from "../src/core/symbol-morph.ts";
import { Field } from "../src/application/field.ts";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import { globalAttachments } from "../src/application/attachments.ts";
import {
  projectAttachment,
  contentMaterialSide,
} from "../src/geometry/attachments.ts";
import { nodeS } from "../src/geometry/field.ts";

const makeField = () =>
  new Field(new Catalog(hubDefinitions, rawContent), {
    width: 1366,
    height: 820,
  });

function parsePathPoints(d: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const m of d.matchAll(/[ML](-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    pts.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return pts;
}

test("Symbol Morph Geometric Continuity: endpoints m=0, m=1 and intermediate states m=0.01..0.99 are finite and continuous", () => {
  const samples = [0, 0.01, 0.25, 0.49, 0.5, 0.51, 0.75, 0.99, 1];
  for (const kind of SYMBOL_KINDS) {
    const g0 = evaluateSymbol(kind, 0);
    const g1 = evaluateSymbol(kind, 1);
    assert.equal(
      g0.paths.length,
      g1.paths.length,
      `${kind} path count must stay invariant`,
    );
    assert.equal(
      g0.points.length,
      g1.points.length,
      `${kind} point count must stay invariant`,
    );
    assert.deepEqual(
      g0.paths.map((p) => p.id),
      g1.paths.map((p) => p.id),
      `${kind} path IDs must correspond 1-to-1`,
    );
    assert.deepEqual(
      g0.points.map((p) => p.id),
      g1.points.map((p) => p.id),
      `${kind} point IDs must correspond 1-to-1`,
    );

    for (const m of samples) {
      const g = evaluateSymbol(kind, m);
      assert.equal(g.morph, m);
      for (const p of g.paths) {
        assert.ok(p.d.length > 4, `${kind} at m=${m} path ${p.id} non-empty`);
        assert.doesNotMatch(
          p.d,
          /NaN|Infinity|undefined/,
          `${kind} at m=${m} path ${p.id} finite`,
        );
        // Never use opacity cross-fading to fake a morph
        assert.equal(
          p.opacity ?? 1,
          1,
          `${kind} path ${p.id} must not cross-fade`,
        );
      }
      for (const pt of g.points) {
        assert.ok(
          Number.isFinite(pt.x + pt.y + pt.r),
          `${kind} at m=${m} point ${pt.id} finite`,
        );
        assert.ok(
          pt.r > 0.5,
          `${kind} at m=${m} point ${pt.id} positive radius`,
        );
      }
    }

    // Check continuity across midpoint m = 0.49 -> 0.50 -> 0.51 (no discontinuity or jump)
    const g49 = evaluateSymbol(kind, 0.49);
    const g50 = evaluateSymbol(kind, 0.5);
    const g51 = evaluateSymbol(kind, 0.51);
    for (let i = 0; i < g50.paths.length; i++) {
      const pts49 = parsePathPoints(g49.paths[i].d);
      const pts50 = parsePathPoints(g50.paths[i].d);
      const pts51 = parsePathPoints(g51.paths[i].d);
      assert.equal(pts49.length, pts50.length);
      assert.equal(pts50.length, pts51.length);
      for (let j = 0; j < pts50.length; j++) {
        const stepA = Math.hypot(
          pts50[j].x - pts49[j].x,
          pts50[j].y - pts49[j].y,
        );
        const stepB = Math.hypot(
          pts51[j].x - pts50[j].x,
          pts51[j].y - pts50[j].y,
        );
        assert.ok(
          stepA < 0.35,
          `${kind} path ${g50.paths[i].id} smooth across 0.49->0.50 (${stepA})`,
        );
        assert.ok(
          stepB < 0.35,
          `${kind} path ${g50.paths[i].id} smooth across 0.50->0.51 (${stepB})`,
        );
      }
    }
    for (let i = 0; i < g50.points.length; i++) {
      const dA = Math.hypot(
        g50.points[i].x - g49.points[i].x,
        g50.points[i].y - g49.points[i].y,
      );
      const dB = Math.hypot(
        g51.points[i].x - g50.points[i].x,
        g51.points[i].y - g50.points[i].y,
      );
      assert.ok(
        dA < 0.25 && dB < 0.25,
        `${kind} point ${g50.points[i].id} smooth across 0.50`,
      );
    }
  }
});

test("Symbol Morph Reversibility: forward and reverse evaluations at any progress m are identical", () => {
  const forwardSteps = [0, 0.12, 0.25, 0.37, 0.5, 0.68, 0.84, 0.99, 1];
  const reverseSteps = [...forwardSteps].reverse();
  for (const kind of SYMBOL_KINDS) {
    const forward = forwardSteps.map((m) => evaluateSymbol(kind, m));
    const reverse = reverseSteps.map((m) => evaluateSymbol(kind, m)).reverse();
    assert.deepEqual(
      forward,
      reverse,
      `${kind} reverse evaluation must match forward evaluation`,
    );
  }
});

test("selected global icons stay static through hub morph, pause and host switch", () => {
  const f = makeField();
  const shapes = globalAttachments(f.state, f.catalog).map(
    (g) => g.icon!.shapes,
  );
  for (const morph of [0, 0.25, 0.5, 0.75, 1, 0]) {
    f.hub.morph = f.hub.targetMorph = morph;
    const globals = globalAttachments(f.state, f.catalog);
    assert.deepEqual(
      globals.map((g) => g.icon!.shapes),
      shapes,
    );
    assert.ok(
      globals.every(
        (g) => g.symbolGeometry === undefined && g.symbolMorph === undefined,
      ),
    );
  }
  for (const hub of ["D", "B"]) {
    f.state.focus = hub;
    const globals = globalAttachments(f.state, f.catalog);
    assert.ok(globals.every((g) => g.anchor.hostHub === hub));
    assert.deepEqual(
      globals.map((g) => g.icon!.shapes),
      shapes,
    );
  }
});

test("Symbol Morph Visual Consistency: optical bounds, centroids, and projected zoom", () => {
  for (const m of [0, 0.25, 0.5, 0.75, 1]) {
    const sizes: number[] = [];
    for (const kind of SYMBOL_KINDS) {
      const g = evaluateSymbol(kind, m);
      const b = measureSymbolBounds(g);
      // Visual footprint stays balanced inside the 24x24 grid without shrinking or exploding
      assert.ok(
        b.width >= 11.5 && b.width <= 18.5,
        `${kind} m=${m} width=${b.width}`,
      );
      assert.ok(
        b.height >= 10.5 && b.height <= 18.5,
        `${kind} m=${m} height=${b.height}`,
      );
      // Visual centroid stays near (12, 12) without large drift
      assert.ok(
        Math.abs(b.centerX - 12) <= 2.2,
        `${kind} m=${m} centerX=${b.centerX}`,
      );
      assert.ok(
        Math.abs(b.centerY - 12) <= 2.2,
        `${kind} m=${m} centerY=${b.centerY}`,
      );
      sizes.push((b.width + b.height) / 2);
    }
    const maxSpan = Math.max(...sizes);
    const minSpan = Math.min(...sizes);
    assert.ok(
      maxSpan - minSpan < 3.6,
      `at m=${m}, 4 icons have balanced visual size (${minSpan}..${maxSpan})`,
    );
  }

  // Optical tokens stay in local coordinates; projection scales their attachments.
  const f = makeField();
  const h = f.hub;
  const s0 = nodeS(
    h,
    h.scroll,
    f.siblings().length,
    f.state.camera,
    f.state.viewport,
  );
  const sign = contentMaterialSide(h, s0, f.state.camera, 1);
  const attach = globalAttachments(f.state, f.catalog)[0];
  for (const z of [0.28, 0.65, 1.0, 1.85]) {
    f.state.camera.z = z;
    const proj = projectAttachment(
      h,
      attach,
      f.state.camera,
      f.state.viewport,
      sign,
    );
    const dist = Math.hypot(
      proj.position.x - proj.hinge.x,
      proj.position.y - proj.hinge.y,
    );
    assert.ok(
      Math.abs(dist - 52 * z) < 1e-5,
      `normal offset follows zoom=${z}`,
    );
    assert.equal(SYMBOL_OPTICAL_TOKENS[attach.symbolKind!].sizePx, 20);
    assert.equal(SYMBOL_OPTICAL_TOKENS[attach.symbolKind!].hitSizePx, 44);
  }
});

test("Symbol Morph Orthogonal Interaction Feedback: activity a in [0, 1] responds without altering morph", () => {
  for (const kind of SYMBOL_KINDS as readonly SymbolKind[]) {
    for (const m of [0, 0.5, 1]) {
      const idle = evaluateSymbol(kind, m, 0);
      const hovered = evaluateSymbol(kind, m, 0.62);
      const pressed = evaluateSymbol(kind, m, 1.0);
      // Morph parameter is strictly preserved
      assert.equal(idle.morph, m);
      assert.equal(hovered.morph, m);
      assert.equal(pressed.morph, m);
      // Activity produces a real, bounded geometric response
      const diffHover =
        JSON.stringify(idle.paths) !== JSON.stringify(hovered.paths) ||
        JSON.stringify(idle.points) !== JSON.stringify(hovered.points);
      const diffPress =
        JSON.stringify(hovered.paths) !== JSON.stringify(pressed.paths) ||
        JSON.stringify(hovered.points) !== JSON.stringify(pressed.points);
      assert.ok(diffHover, `${kind} at m=${m} responds to hover activity`);
      assert.ok(diffPress, `${kind} at m=${m} responds to press activity`);
    }
  }
});
