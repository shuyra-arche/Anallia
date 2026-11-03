import test from 'node:test';
import assert from 'node:assert/strict';
import { Field } from '../src/application/field.ts';
import { Catalog } from '../src/content/catalog.ts';
import { hubDefinitions, rawContent } from '../src/content/field.ts';
import { fitOverviewCamera, type OverviewRegion } from '../src/geometry/overview.ts';
import { evaluateHubCurve } from '../src/geometry/graphics.ts';
import { material, worldToScreen } from '../src/geometry/field.ts';

const create = (width = 390, height = 844) => new Field(new Catalog(hubDefinitions, rawContent), { width, height }, true);
const settle = (field: Field) => { for (let i = 0; i < 30; i++) field.update(field.state.elapsed + 20, 20); };
const cameraClose = (a: { x: number; y: number; z: number; rotation: number }, b: typeof a) => { for (const key of ['x', 'y', 'z', 'rotation'] as const) assert.ok(Math.abs(a[key] - b[key]) < 1e-8, key); };
const region = { left: 24, top: 127, width: 342, height: 430 };
function containsGeometry(field: Field, area: OverviewRegion) {
  const { camera, viewport, hubs } = field.state;
  for (const hub of Object.values(hubs)) {
    const curve = evaluateHubCurve(hub, camera, viewport);
    const points = curve.kind === 'circle'
      ? [{ x: curve.cx - curve.radius, y: curve.cy - curve.radius }, { x: curve.cx + curve.radius, y: curve.cy + curve.radius }]
      : [worldToScreen(material(hub, 0), camera, viewport)];
    for (const point of points) {
      assert.ok(point.x >= area.left && point.x <= area.left + area.width, `${hub.id} horizontal containment`);
      assert.ok(point.y >= area.top && point.y <= area.top + area.height, `${hub.id} vertical containment`);
    }
  }
}

test('overview fits actual circles and line anchors into portrait and short landscape regions', () => {
  for (const [width, height, area] of [
    [320, 568, { left: 24, top: 127, width: 272, height: 190 }],
    [390, 844, region],
    [568, 320, { left: 268, top: 127, width: 276, height: 147 }],
  ] as const) {
    const field = create(width, height);
    field.hub.angle = 137;
    field.state.hubs.B.morph = 0; // A previously linear hub has become a circle.
    field.state.hubs.D.morph = 1;
    field.state.camera = fitOverviewCamera(field.state.viewport, Object.values(field.state.hubs), area);
    containsGeometry(field, area);
  }
});

test('manual zoom stays below the reading floor without snapping, and refit adds no history', () => {
  const field = create();
  field.dispatch({ type: 'overview' }); field.fitOverview(region); settle(field);
  const z = field.state.camera.z;
  assert.ok(z < 0.18);
  field.zoom(1.1, { x: 150, y: 260 });
  assert.ok(Math.abs(field.state.camera.z - z * 1.1) < 1e-10);
  const manual = { ...field.state.camera };
  field.fitOverview({ ...region, height: 620 }); settle(field);
  assert.deepEqual(field.state.camera, manual, 'layout reports must not override a manual camera');
  const history = field.state.history.length;
  field.dispatch({ type: 'overview' }); settle(field);
  assert.equal(field.state.history.length, history);
  containsGeometry(field, { ...region, height: 620 });
  field.dispatch({ type: 'toggle-overview-map' });
  assert.equal(field.state.overviewPanel, 'collapsed');
});

test('return restores manual overview camera and panel; resize then return fits the new viewport', () => {
  const field = create();
  field.dispatch({ type: 'overview' }); field.fitOverview(region); settle(field);
  field.dispatch({ type: 'toggle-overview-map' }); field.fitOverview({ ...region, height: 620 }); settle(field);
  field.zoom(1.4, { x: 100, y: 300 });
  const camera = { ...field.state.camera };
  field.dispatch({ type: 'focus', hub: 'B' }); settle(field);
  field.dispatch({ type: 'back' }); settle(field);
  field.fitOverview({ ...region, height: 620 }); settle(field);
  assert.equal(field.state.overviewPanel, 'collapsed');
  cameraClose(field.state.camera, camera);
  field.dispatch({ type: 'focus', hub: 'A' }); settle(field);
  field.resize({ width: 320, height: 568 }); settle(field);
  field.dispatch({ type: 'back' });
  const smaller = { left: 24, top: 127, width: 272, height: 340 };
  field.fitOverview(smaller); settle(field);
  containsGeometry(field, smaller);
});

test('desktop overview also fits measured space and reading keeps its normal zoom floor', () => {
  const desktop = create(1366, 820);
  desktop.dispatch({ type: 'overview' }); settle(desktop);
  const available = { left: 250, top: 84, width: 1088, height: 650 };
  desktop.fitOverview(available); settle(desktop);
  containsGeometry(desktop, available);
  const mobile = create();
  mobile.zoom(0.001, { x: 100, y: 200 });
  assert.equal(mobile.state.camera.z, 0.18);
});
