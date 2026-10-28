import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/content/catalog.ts";
import { hubDefinitions, rawContent } from "../src/content/field.ts";
import { Field } from "../src/application/field.ts";
import { classifyTransition, pageTurnPose, selectSpatialTransition, readingEnvelope } from "../src/core/transitions.ts";
import { material, nodeS, worldToScreen, remotePortalGeometry } from "../src/geometry/field.ts";
const viewport = {width: 1366, height: 820};
const create = (reduced = false) => new Field(new Catalog(hubDefinitions, rawContent), viewport, reduced);
const settle = (f:Field, from = 0, frames = 90) => {
  for (let i=1; i<=frames; i++) f.update(from + i*20, 20);
};
const select = (f:Field) => {
  const siblings = f.siblings();
  const index = siblings.findIndex(n=>n.id===f.selected().id);
  const s = nodeS(f.hub,index,siblings.length,f.state.camera,f.state.viewport);
  return material(f.hub,s);
};

test("structure still distinguishes siblings and recursive depth",()=>{
  assert.equal(classifyTransition("S", ["s0"], "S", ["s0","s1"]),"unfold");
  assert.equal(classifyTransition("S", ["s0","s1"], "S", ["s0","s2"]),"traverse");
  assert.equal(classifyTransition("S", ["s0","s1"], "A", ["a0"]),"passage");
});

test("settings ⚙0→⚙1 changes only content at an invariant material hinge",()=>{
  const f = create();
  f.dispatch({type:"navigate",target:"s0"});
  settle(f);
  assert.equal(f.selected().id,"s0");
  const pivotBefore = select(f), cameraBefore = {...f.state.camera};
  const morphBefore = f.hub.morph, foldBefore = f.hub.fold;
  f.dispatch({type:"navigate",target:"s1"});
  assert.ok(f.state.contentTurn);
  assert.equal(f.state.passage,null);
  assert.equal(f.state.morphTurn,null);
  assert.deepEqual(f.state.camera,cameraBefore);
  f.update(1800+170,20);
  assert.equal(f.selected().id,"s0");
  f.update(1800+340,20);
  assert.equal(f.selected().id,"s1");
  assert.deepEqual(select(f), pivotBefore);
  assert.deepEqual(f.state.camera,cameraBefore);
  assert.equal(f.hub.morph,morphBefore);
  assert.equal(f.hub.fold,foldBefore);
  settle(f,1800+340);
  assert.equal(f.state.contentTurn,null);
});

test("content back reverses page-turn direction and holds the material hinge",()=>{
  const f=create();
  f.dispatch({type:"navigate",target:"s0"}); settle(f);
  f.dispatch({type:"navigate",target:"s1"}); settle(f,1800);
  const hinge=select(f), shape=f.hub.morph;
  f.dispatch({type:"back"});
  assert.equal(f.state.contentTurn?.direction,-1);
  assert.equal(f.state.passage,null);
  settle(f,3600);
  assert.equal(f.selected().id,"s0");
  assert.deepEqual(select(f),hinge);
  assert.equal(f.hub.morph,shape);
});

test("sibling Traverse does not flip or morph",()=>{
  const f=create();
  f.dispatch({type:"navigate",target:"s0"}); settle(f);
  f.dispatch({type:"navigate",target:"s1"}); settle(f,1800);
  const m=f.hub.morph;
  f.dispatch({type:"navigate",target:"s2"});
  assert.equal(f.state.contentTurn,null);
  assert.equal(f.state.morphTurn,null);
  assert.equal(f.state.passage,null);
  assert.equal(f.hub.morph,m);
});

test("circle↔line invokes only Möbius Morph, no automatic page flip",()=>{
  const f=create();
  f.dispatch({type:"morph"});
  assert.ok(f.state.morphTurn);
  assert.equal(f.state.contentTurn,null);
  assert.equal(f.state.passage,null);
  f.update(420,20);
  assert.ok(f.hub.morph>.4 && f.hub.morph<.6);
  settle(f,420);
  assert.equal(f.hub.morph,1);
  f.dispatch({type:"morph"});
  assert.equal(f.state.contentTurn,null);
  settle(f,2220);
  assert.equal(f.hub.morph,0);
});

test("cross-hub navigation routes by distance, not by content changes",()=>{
  const f=create();
  const B=f.state.hubs.B, A=f.hub;
  B.center={x:A.center.x+100,y:A.center.y+200};
  f.dispatch({type:"navigate",target:"b1"});
  assert.equal(f.state.passage?.kind,"near");
  assert.equal(f.state.contentTurn,null);
  assert.equal(f.state.morphTurn,null);
});

test("Near/Flight/Remote thresholds are relative to screen and frozen at dispatch",()=>{
  const f=create();
  const A=f.hub, B=f.state.hubs.B;
  const camera={...f.state.camera,z:1};
  B.center={x:A.center.x+100,y:A.center.y};
  assert.equal(selectSpatialTransition(A,B,camera,viewport),"near");
  B.center={x:A.center.x+800,y:A.center.y};
  assert.equal(selectSpatialTransition(A,B,camera,viewport),"flight");
  B.center={x:A.center.x+13000,y:A.center.y};
  assert.equal(selectSpatialTransition(A,B,camera,viewport),"remote");
  B.parentHub=A.id;
  assert.equal(selectSpatialTransition(A,B,camera,viewport),"axis");
});

test("only far distance uses a portal; stable screen-space Möbius reference",()=>{
  const f=create();
  const cam1={...f.state.camera,z:0.7};
  const cam2={x:23000,y:-500,z:2.1,rotation:140};
  for (const p of [0,.01,.25,.4999,.5,.5001,.75,.99,1]){
    const a=remotePortalGeometry(p,cam1,viewport);
    const b=remotePortalGeometry(p,cam2,viewport);
    assert.doesNotMatch(a.strokeD+a.sweptClipD,/NaN|Infinity/);
    assert.deepEqual(a,b,`remote mask should not drift at p=${p}`);
  }
});

test("page leaf is never readable on its back face",()=>{
  for (const p of [.35,.45,.5,.55,.65]) assert.equal(pageTurnPose(p).opacity,0);
  assert.equal(pageTurnPose(0).angle,0);
  assert.equal(pageTurnPose(1).angle,360);
  assert.equal(pageTurnPose(1,false,-1).angle,-360);
});

test("content flip queues last intent rather than starting a portal halfway",()=>{
  const f=create();
  f.dispatch({type:"navigate",target:"s0"}); settle(f);
  f.dispatch({type:"navigate",target:"s1"});
  f.dispatch({type:"navigate",target:"b1"});
  f.dispatch({type:"navigate",target:"c0"});
  assert.equal(f.state.passage,null);
  f.update(2500,20);
  assert.equal(f.state.passage?.target,"C");
  settle(f,2500);
  assert.equal(f.selected().id,"c0");
});

test("reduced motion commits content immediately on next logical frame",()=>{
  const f=create(true);
  f.dispatch({type:"navigate",target:"s0"}); f.update(20,20);
  f.dispatch({type:"navigate",target:"s1"});
  f.update(40,20);
  assert.equal(f.selected().id,"s1");
  assert.equal(f.state.contentTurn,null);
});

test("reading envelope still protects cross-hub semantic midpoint",()=>{
  assert.equal(readingEnvelope(.5),0);
  assert.equal(readingEnvelope(0),1);
  assert.equal(readingEnvelope(1),1);
  const f=create();
  const anchor=worldToScreen(select(f),f.state.camera,viewport);
  assert.ok(Number.isFinite(anchor.x+anchor.y));
});

test("line-form settings content flip preserves the same hinge and never runs Möbius",()=>{
  const f=create();
  f.dispatch({type:"navigate",target:"s0"}); settle(f);
  f.dispatch({type:"morph"}); settle(f,1800);
  assert.equal(f.hub.morph,1);
  const source=select(f),camera={...f.state.camera};
  f.dispatch({type:"navigate",target:"s1"});
  assert.ok(f.state.contentTurn);
  assert.equal(f.state.morphTurn,null);
  assert.equal(f.state.passage,null);
  settle(f,3600);
  assert.equal(f.selected().id,"s1");
  assert.deepEqual(select(f),source);
  assert.deepEqual(f.state.camera,camera);
  assert.equal(f.hub.morph,1);
});

test("remote travel does not borrow a content page clock",()=>{
  const f=create();
  f.state.hubs.B.center={x:f.hub.center.x+14000,y:f.hub.center.y};
  f.dispatch({type:"navigate",target:"b1"});
  assert.equal(f.state.passage?.kind,"remote");
  assert.equal(f.state.contentTurn,null);
  assert.equal(f.state.morphTurn,null);
  f.update(200,20);
  assert.equal(f.state.contentTurn,null);
  assert.ok(f.state.hubs.A.fold>0);
  settle(f,200);
  assert.equal(f.selected().id,"b1");
  assert.equal(f.state.hubs.A.fold,0);
  assert.equal(f.state.hubs.B.fold,0);
});

test("back is a content-only flip even if presentation changed after the snapshot",()=>{
  const f=create();
  f.dispatch({type:"navigate",target:"s0"}); settle(f);
  f.dispatch({type:"navigate",target:"s1"}); settle(f,1800);
  f.dispatch({type:"morph"}); settle(f,3600);
  assert.equal(f.hub.morph,1);
  f.dispatch({type:"back"});
  assert.ok(f.state.contentTurn);
  assert.equal(f.state.morphTurn,null);
  settle(f,5400);
  assert.equal(f.selected().id,"s0");
  assert.equal(f.hub.morph,1);
});
