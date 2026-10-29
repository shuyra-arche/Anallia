import test from "node:test";
import assert from "node:assert/strict";
import { clippedDashes } from "../src/geometry/clipped-dashes.ts";
const clip = { left: 0, top: 0, right: 100, bottom: 100 };
test("offscreen source distance preserves visible dash phase without generating offscreen dashes", () => {
  const paths = clippedDashes([{x:-10003,y:20},{x:10000,y:20}], [4,6], clip);
  assert.equal(paths.length, 11);
  assert.ok(Math.abs(paths[0][0].x) < 1e-9);
  assert.ok(Math.abs(paths[0][1].x - 1) < 1e-9);
  assert.ok(Math.abs(paths[1][0].x - 7) < 1e-9);
  assert.ok(Math.abs(paths[1][1].x - 11) < 1e-9);
  for (const path of paths) for (const point of path) assert.ok(point.x >= -1e-9 && point.x <= 100+1e-9);
});
test("visible dashes remain joined across source vertices and skip zero-length segments", () => {
  const paths = clippedDashes([{x:-3,y:5},{x:5,y:5},{x:5,y:5},{x:5,y:15}], [100,1], {left:0,top:0,right:10,bottom:10});
  assert.deepEqual(paths, [[{x:0,y:5},{x:5,y:5},{x:5,y:10}]]);
});
test("odd patterns, reverse travel and clipped gaps follow source arclength", () => {
  const paths = clippedDashes([{x:9,y:5},{x:-2,y:5}], [3], {left:0,top:0,right:7,bottom:10});
  assert.deepEqual(paths, [[{x:7,y:5},{x:6,y:5}],[{x:3,y:5},{x:0,y:5}]]);
  const hidden=clippedDashes([{x:-20,y:-20},{x:-20,y:10},{x:20,y:10}], [4,6], clip);
  assert.ok(Math.abs(hidden[0][0].x) < 1e-9);
  assert.ok(Math.abs(hidden[0][1].x - 4) < 1e-9);
});
test("unseen and invalid paths are empty", () => {
  assert.deepEqual(clippedDashes([{x:-20,y:-20},{x:-10,y:-10}], [4,6], clip), []);
  assert.deepEqual(clippedDashes([{x:0,y:0},{x:Infinity,y:0}], [4,6], clip), []);
  assert.deepEqual(clippedDashes([{x:0,y:0},{x:10,y:0}], [0,-1], clip), []);
});
