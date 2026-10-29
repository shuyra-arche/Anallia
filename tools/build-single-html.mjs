import "./content-manifest.mjs";
import { build } from "vite";
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), "shuyra-offline-"));
try {
  await build({ root, base: "./", build: {
    outDir, emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: Infinity,
    rollupOptions: { output: { inlineDynamicImports: true } },
  } });
  let html = await readFile(join(outDir, "index.html"), "utf8");
  for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
    const code = await readFile(join(outDir, match[1]), "utf8");
    html = html.replace(match[0], () => `<script type="module">${code.replace(/<\/script/gi, "<\\/script")}</script>`);
  }
  for (const match of [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]) {
    const css = await readFile(join(outDir, match[1]), "utf8");
    html = html.replace(match[0], () => `<style>${css}</style>`);
  }
  html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
  const license = await readFile(join(root, "public/licenses/lucide.txt"), "utf8");
  html += `\n<!-- Lucide license\n${license.replaceAll("--", "- -")}\n-->`;
  await writeFile(join(root, "demo.html"), html);
  console.log("Bundled offline single-file demo ready: demo.html");
} finally {
  await rm(outDir, { recursive: true, force: true });
}
