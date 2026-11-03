import test from 'node:test';
import assert from 'node:assert/strict';
import { createTideAtlas, tidePlaces } from '../src/examples/tide-atlas.ts';
import { Catalog } from '../src/content/catalog.ts';
import { captureSessionAnchor, resolveSessionAnchor } from '../src/core/reader-snapshot.ts';
import { parseContent } from '../src/content/parser.ts';

test('the atlas connects an original hierarchy, cross-hub references and generated search', () => {
  const definition = createTideAtlas(), catalog = new Catalog(definition.manifest.definitions, definition.manifest);
  assert.equal(definition.entry, 'shore-entry');
  assert.equal(catalog.chapters.has('a0'), false);
  assert.deepEqual(catalog.chain('shell-back'), ['shore-entry','shore-tide','shell-back']);
  assert.equal(catalog.get('light-entry').hub, 'LIGHT');
  assert.ok(catalog.search('蓝纸').some(chapter => chapter.id === 'q_hit_light-keeper'));
  for (const place of tidePlaces) assert.equal(catalog.get(place.chapter).hub, place.hub);
  assert.equal(catalog.get('shell-back').refs[0].target, 'letter-entry');
  catalog.destroy();
});

test('authored long reading shares exact semantic blocks between circle and line', async () => {
  const definition=createTideAtlas();
  const read=async (presentation:'circle'|'line')=>{let value='';for await(const patch of definition.source.open('light-keeper',presentation,new AbortController().signal)) value=patch.text;return value;};
  const circle=await read('circle'), line=await read('line');
  assert.equal(circle,line); assert.ok(circle.length > 600);
  const parsed=parseContent(circle); assert.ok(parsed.blocks.length > 8);
  // The existing session matcher, not a new edition-owned offset, resolves the text.
  const block=parsed.blocks[4];
  assert.ok(block.sourceStart > 100);
  const source=block.sourceStart+12;
  const anchor=captureSessionAnchor(parsed,source);
  assert.ok(anchor);
  assert.equal(resolveSessionAnchor(anchor,parseContent(line)),source);
});
