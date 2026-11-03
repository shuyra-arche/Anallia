import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldNotebook } from '../src/examples/field-notebook.ts';
import { Catalog } from '../src/content/catalog.ts';
import { Field } from '../src/application/field.ts';
import { globalAttachments } from '../src/application/attachments.ts';
import { readerLocation } from '../src/application/reader-navigation.ts';
import { symbolActivity } from '../src/geometry/scene-frame.ts';
import { createLeavesIxDemo, leavesIxPages } from '../src/demos/leaves-ix-content.ts';
import { contentManifest } from '../src/content/generated/manifest.ts';

const fresh = () => structuredClone(createFieldNotebook().manifest);
test('utility capability controls geometry, activity and directory independently of glyph and root spelling', () => {
  const manifest = fresh();
  manifest.definitions[0].kind = 'settings';
  manifest.definitions[0].glyph = '工具';
  manifest.definitions.find(h => h.kind === 'search')!.glyph = '找';
  const catalog = new Catalog(manifest.definitions, manifest);
  const field = new Field(catalog, { width: 390, height: 844 }, true);
  const globals = globalAttachments(field.state, catalog);
  assert.equal(catalog.settingsRoot, 'obs-start');
  assert.deepEqual(globals.find(g => g.id === 'global:settings')?.command, { type: 'navigate', target: 'obs-start' });
  assert.deepEqual(globals.find(g => g.id === 'global:search')?.command, { type: 'navigate', target: 'find-start' });
  assert.equal(symbolActivity(undefined, 'settings', field.state), .35);
  field.state.focus = 'FIND';
  assert.equal(symbolActivity(undefined, 'search', field.state), .35);
  field.state.overview = true;
  const location = readerLocation(field.state, catalog);
  assert.equal(location.kind, 'overview');
  if (location.kind === 'overview') assert.deepEqual(location.destinations.map(h => h.hub), ['LOG', 'ATLAS']);
});

test('ambiguous capabilities and dangling boundary routes fail at catalog construction', () => {
  const duplicate = fresh(); duplicate.definitions[0].kind = 'search';
  assert.throws(() => new Catalog(duplicate.definitions, duplicate), /Duplicate utility capability/);
  const dangling = fresh(); dangling.chapters[0].boundaryRoutes = { next: 'missing' };
  assert.throws(() => new Catalog(dangling.definitions, dangling), /Unknown chapter/);
});

test('authored boundary routes work for ordinary IDs and preserve same-level priority', () => {
  for (const [delta, target] of [[-1, 'log-start'], [1, 'atlas-start']] as const) {
    const manifest = fresh();
    manifest.chapters.find(c => c.id === 'obs-start')!.boundaryRoutes = { previous: 'log-start', next: 'atlas-start' };
    const field = new Field(new Catalog(manifest.definitions, manifest), { width: 1366, height: 820 }, true);
    field.dispatch({ type: 'step', delta });
    for (let i = 1; i <= 80; i++) field.update(i * 20, 20);
    assert.equal(field.selected().id, target);
  }
  const manifest = fresh();
  manifest.chapters.find(c => c.id === 'log-day')!.boundaryRoutes = { next: 'atlas-start' };
  const field = new Field(new Catalog(manifest.definitions, manifest), { width: 1366, height: 820 }, true);
  field.state.focus = 'LOG'; field.hub.path = field.catalog.chain('log-day');
  field.dispatch({ type: 'step', delta: 1 });
  for (let i = 1; i <= 80; i++) field.update(i * 20, 20);
  assert.equal(field.selected().id, 'log-noon');
});

test('IX explicitly declares its existing route fallback; core no longer infers ID prefixes or ref order', () => {
  const { manifest } = createLeavesIxDemo(contentManifest, { async *open() {} });
  const catalog = new Catalog(manifest.definitions, manifest);
  for (const page of leavesIxPages) assert.deepEqual(catalog.boundaryRoutes(page.id), {
    next: page.next, previous: page.parent ?? (page.id === 'ix-entry' ? 'ix-exit' : page.note),
  });
});
