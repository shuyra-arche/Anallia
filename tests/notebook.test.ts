import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldNotebook, notebookRows } from '../src/examples/field-notebook.ts';
import { Catalog } from '../src/content/catalog.ts';
import { Field } from '../src/application/field.ts';
import { globalAttachments } from '../src/application/attachments.ts';
import { readerLocation } from '../src/application/reader-navigation.ts';
import { fitOverviewCamera } from '../src/geometry/overview.ts';

const create = () => {
  const { manifest } = createFieldNotebook();
  const catalog = new Catalog(manifest.definitions, manifest);
  return new Field(catalog, { width: 1366, height: 820 }, true);
};

test('independent notebook has five-level paths, valid cross-hub references and custom search', () => {
  const field = create();
  assert.equal(field.catalog.definitions.length, 4);
  assert.equal(createFieldNotebook().manifest.chapters.length, 15);
  assert.equal(field.catalog.chain('obs-mark').length, 5);
  assert.equal(field.catalog.searchRoot, 'find-start');
  for (const id of ['A', 'S', 'Q']) assert.equal(field.state.hubs[id], undefined);
  for (const id of ['a0', 's0', 'q0']) assert.equal(field.catalog.chapters.has(id), false);
  assert.ok(field.catalog.search('砖缝').some(node => field.catalog.sourceChapterId(node.id) === 'obs-mark'));
  const entries = globalAttachments(field.state, field.catalog);
  assert.ok(entries.some(entry => entry.id === 'global:search'));
  assert.ok(!entries.some(entry => entry.id === 'global:settings'));
  field.dispatch({ type: 'overview' });
  const location = readerLocation(field.state, field.catalog);
  assert.equal(location.kind, 'overview');
  if (location.kind === 'overview') assert.equal(location.destinations.length, 3);
});

test('a content catalog without optional search or settings still has overview and back operations', () => {
  const { manifest } = createFieldNotebook();
  const independent = { ...manifest, definitions: manifest.definitions.filter(h => h.id !== 'FIND'), chapters: manifest.chapters.filter(c => c.hub !== 'FIND') };
  const catalog = new Catalog(independent.definitions, independent);
  const field = new Field(catalog, { width: 390, height: 844 });
  assert.deepEqual(globalAttachments(field.state, catalog).map(entry => entry.id), ['global:overview', 'global:back']);
});

test('notebook uses the existing chunked local source and respects cancellation', async () => {
  const { source } = createFieldNotebook();
  const expected = notebookRows.LOG.find(row => row[0] === 'log-day')![5];
  assert.ok(expected.length > 3000);
  const controller = new AbortController();
  const patches = [];
  for await (const patch of source.open('log-day', 'line', controller.signal)) patches.push(patch);
  assert.ok(patches.length > 30);
  assert.equal(patches.map(p => p.text).join(''), expected);
  let count = 0;
  for await (const patch of source.open('log-day', 'circle', controller.signal)) {
    assert.ok(patch.text); count++; controller.abort();
  }
  assert.equal(count, 1);
});

test('overview fitting is invariant to translated content coordinates on desktop', () => {
  const field = create();
  const region = { left: 240, top: 84, width: 1100, height: 650 };
  const first = fitOverviewCamera(field.state.viewport, Object.values(field.state.hubs), region);
  const offset = { x: 12000, y: -5700 };
  const moved = Object.values(field.state.hubs).map(h => ({ ...h, center: { x: h.center.x + offset.x, y: h.center.y + offset.y } }));
  const second = fitOverviewCamera(field.state.viewport, moved, region);
  assert.ok(Math.abs(second.x - first.x - offset.x) < 1e-8);
  assert.ok(Math.abs(second.y - first.y - offset.y) < 1e-8);
  assert.ok(Math.abs(second.z - first.z) < 1e-10);
});

test('the two authored noon expressions match only their shared paragraph', async () => {
  const { parseContent } = await import('../src/content/parser.ts');
  const { matchContentAnchor } = await import('../src/core/reading-continuity.ts');
  const row = notebookRows.LOG.find(row => row[0] === 'log-noon')!;
  const circle = parseContent(row[4]), line = parseContent(row[5]);
  const source = circle.source.indexOf('两片叶子');
  assert.deepEqual(matchContentAnchor({ document: circle, source }, line), { kind: 'matched', source: line.source.indexOf('两片叶子') });
  assert.deepEqual(matchContentAnchor({ document: circle, source: 2 }, line), { kind: 'unavailable' });
});
