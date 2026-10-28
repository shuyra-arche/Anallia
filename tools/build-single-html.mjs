// Make an offline, single-file demo from the statically transpiled preview.
// This is deliberately separate from the normal Vite production build.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
const root = new URL('../', import.meta.url).pathname;
const dir = join(root, 'preview');
const imports = {};
async function walk(where) {
  for (const item of await readdir(where, {withFileTypes:true})) {
    const absolute = join(where,item.name);
    if (item.isDirectory()) { await walk(absolute); continue; }
    if (!item.name.endsWith('.js')) continue;
    const id = `shuyra/${relative(dir,absolute)}`;
    let src = await readFile(absolute, 'utf8');
    src = src.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_all,a,rel,b) => {
      const destination = relative(dir, new URL(rel, `file://${absolute}`).pathname);
      return `${a}shuyra/${destination}${b}`;
    });
    imports[id] = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
  }
}
await walk(join(dir,'src'));
let html = await readFile(join(dir,'index.html'),'utf8');
const css = await readFile(join(dir,'src/styles.css'),'utf8');
html = html.replace('<link rel="stylesheet" href="./src/styles.css" />', `<style>${css}</style>`);
html = html.replace('<script type="module" src="./src/main.js"></script>', '');
html = html.replace('</head>', `<script type="importmap">${JSON.stringify({imports})}</script></head>`);
html = html.replace('</body>', '<script type="module">import "shuyra/src/main.js";</script></body>');
await writeFile(join(root,'demo.html'),html);
console.log('Offline single-file demo: demo.html');
