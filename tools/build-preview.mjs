/** Zero-dependency preview export for Node >=22 (run from project root). */
import { stripTypeScriptTypes } from "node:module";
import { readdir, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { join, dirname, relative, extname } from "node:path";
const root = new URL("../", import.meta.url).pathname;
const target = join(root, "preview");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
async function walk(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) { await walk(path); continue; }
    const rel = relative(root, path);
    if (extname(path) === ".ts" && !rel.endsWith(".d.ts")) {
      const output = join(target, rel.replace(/\.ts$/, ".js"));
      let content = stripTypeScriptTypes(await readFile(path, "utf8"));
      content = content.replace(/^import\s+["']\.\/styles\.css["'];?\s*$/m, "");
      content = content.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_, a, path, b) =>
        `${a}${path.endsWith(".ts") ? path.replace(/\.ts$/, ".js") : /\.js$/.test(path) ? path : path + ".js"}${b}`);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, content);
    } else if ([".css", ".js"].includes(extname(path))) {
      const output = join(target, rel);
      await mkdir(dirname(output), { recursive: true });
      if (extname(path) === ".js") {
        const content = (await readFile(path, "utf8"))
          .replace(/(from\s+["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
        await writeFile(output, content);
      } else await copyFile(path, output);
    }
  }
}
await walk(join(root, "src"));
let html = await readFile(join(root, "index.html"), "utf8");
html = html.replace(/<script type="module" src="\/src\/main.ts"><\/script>/,
  '<link rel="stylesheet" href="./src/styles.css" /><script type="module" src="./src/main.js"></script>');
await writeFile(join(target, "index.html"), html);
console.log("Static preview ready: preview/index.html (serve preview/ over HTTP)");
