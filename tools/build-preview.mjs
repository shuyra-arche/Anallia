import "./content-manifest.mjs";
import { build } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await build({ root, base: "./", build: { outDir: "preview", emptyOutDir: true } });
console.log("Bundled preview ready: preview/index.html");
