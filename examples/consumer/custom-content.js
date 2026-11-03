import { buildStaticReader } from './vendor/anallia/content.js';

/** Small author-owned input: no manifest, index or source implementation to maintain. */
export function createCustomReader() {
  return buildStaticReader({
    title: '自己的两页内容', entry: 'start',
    hubs: [
      { id: 'NOTES', glyph: '记' },
      { id: 'FIND', glyph: '⌕', kind: 'search', recommendations: ['detail'] },
    ],
    chapters: [
      { id: 'start', hub: 'NOTES', title: '从一份内容开始', name: '记₀',
        body: { circle: '从这份很小的内容开始。\n\n进入{下一页|detail}，再试着返回。',
          line: '同一份内容展开为线。\n\n进入{下一页|detail}，再试着返回。' },
        refs: [{ label: '→', target: 'detail' }] },
      { id: 'detail', hub: 'NOTES', parent: 'start', title: '第二页', name: '记₁',
        body: '这是第二页。它仍然属于同一个枢。' },
      { id: 'find', hub: 'FIND', title: '查找笔记', name: '⌕', body: '试着搜索「第二页」。' },
    ],
  });
}
