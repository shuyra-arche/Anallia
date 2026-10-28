import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAdaptiveLayout } from '../src/core/layout.ts';
import { Field } from '../src/application/field.ts';
import { Catalog } from '../src/content/catalog.ts';
import { hubDefinitions, rawContent } from '../src/content/field.ts';
import { nodeS, material, hubToScreen } from '../src/geometry/field.ts';

const make = (width=1366,height=820) => new Field(new Catalog(hubDefinitions, rawContent), {width,height});
function focusedScreen(f: Field) {
  const nodes=f.siblings();
  const index=nodes.findIndex(n=>n.id===f.selected().id);
  const s=nodeS(f.hub,index,nodes.length,f.state.camera,f.state.viewport);
  return hubToScreen(f.hub,material(f.hub,s),f.state.camera,f.state.viewport);
}
const near = (a:number,b:number,eps=1e-5) => assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test('Morph: camera follows a moving semantic hinge in circle→line without changing zoom',()=>{
  const f=make(); const start=focusedScreen(f); const zoom=f.state.camera.z;
  f.dispatch({type:'morph'});
  for(const t of [0,168,336,504,672,840]) {
    f.update(t,16);
    const p=focusedScreen(f);
    near(p.x,start.x); near(p.y,start.y); near(f.state.camera.z,zoom);
  }
  assert.equal(f.state.morphTurn,null);
  assert.equal(f.hub.morph,1);
});
test('Morph: reverse line→circle pins the same semantic hinge without page turn',()=>{
  const f=make(); f.dispatch({type:'morph'});f.update(840,16);
  const start=focusedScreen(f); const zoom=f.state.camera.z;
  f.dispatch({type:'morph'});
  for(const t of [840,1000,1200,1420,1680]) {
    f.update(t,16);
    const p=focusedScreen(f);
    near(p.x,start.x);near(p.y,start.y);near(f.state.camera.z,zoom);
  }
  assert.equal(f.state.contentTurn,null);
  assert.equal(f.hub.morph,0);
});
test('Grasp: continuous chapter positions then snap; no flip/Möbius',()=>{
  const f=make();f.dispatch({type:'navigate',target:'a31'});
  for(let i=0;i<85;i++)f.update((i+1)*20,20);
  assert.ok(f.siblings().length>3);
  const start=f.hub.scrollTarget;
  f.grasp(0);f.grasp(1.4);
  near(f.hub.scroll,start+1.4);
  assert.equal(f.state.morphTurn,null); assert.equal(f.state.contentTurn,null);
  f.grasp(null);
  assert.equal(f.selected().id,f.siblings()[Math.round(start+1.4)].id);
  near(f.hub.scrollTarget,Math.round(start+1.4));
});
test('Adaptive layout opens right from left edge and left from right edge',()=>{
  const viewport={width:1200,height:800};
  const left=chooseAdaptiveLayout({x:120,y:400},viewport,340,230);
  const right=chooseAdaptiveLayout({x:1060,y:400},viewport,340,230);
  assert.equal(left.side,1); assert.equal(right.side,-1);
  assert.ok(left.left>120 && right.left+right.width<1060);
});
test('Adaptive layout may extend beyond a narrow viewport without changing composition',()=>{
  const v={width:320,height:640};
  const l=chooseAdaptiveLayout({x:260,y:598},v,300,240);
  assert.equal(l.vertical,-1);
  assert.equal(l.width,300);
  assert.equal(l.stacked,false);
  assert.ok(l.left<0 || l.left+l.width>v.width);
  assert.ok(l.top<v.height);
});
test('Orientation hysteresis avoids rapidly flipping near the viewport midpoint',()=>{
  const v={width:1200,height:800};
  const original=chooseAdaptiveLayout({x:575,y:400},v,320,200,{side:1,vertical:1});
  const shifted=chooseAdaptiveLayout({x:596,y:400},v,320,200,original);
  assert.equal(original.side,1);assert.equal(shifted.side,1);
});
