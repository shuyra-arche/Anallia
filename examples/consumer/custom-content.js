/** @returns {import('./vendor/anallia/document.js').ReaderDefinition} */
export function createCustomReader() {
  /** @type {Record<string, {circle: string, line: string}>} */
  const bodies = {
    start: { circle: '从这份很小的内容开始。\n\n进入{下一页|detail}，再试着返回。', line: '同一份内容展开为线。\n\n进入{下一页|detail}，再试着返回。' },
    detail: { circle: '这是第二页。它仍然属于同一个枢。', line: '这是第二页。它仍然属于同一个枢。' },
  };
  return {
    title: '自己的两页内容', entry: 'start',
    manifest: {
      format: 1,
      definitions: [{ id: 'NOTES', glyph: '记', root: 'start', theme: 'parchment', center: { x: 0, y: 0 }, angle: 0, morph: 0 }],
      chapters: [
        { id: 'start', name: '记₀', title: '从一份内容开始', hub: 'NOTES', parent: null, refs: [{ glyph: '→', target: 'detail' }], inlineTargets: ['detail'] },
        { id: 'detail', name: '记₁', title: '第二页', hub: 'NOTES', parent: 'start', refs: [] },
      ],
      searchIndex: [],
    },
    source: {
      async *open(id, presentation, signal) {
        if (signal.aborted) return;
        const text = bodies[id]?.[presentation];
        if (text === undefined) throw new Error(`Unknown content: ${id}`);
        yield { type: 'replace', text };
      },
    },
  };
}
