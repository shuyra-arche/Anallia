import { build } from "vite";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  mkdtemp,
  rm,
  readdir,
} from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "dist-reader");
const entries = {
  embedded: "embedded-reader.ts",
  document: "reader.ts",
  examples: "examples/readers.ts",
  content: "content-builder.ts",
};
const bundled = await build({
  configFile: false,
  root,
  base: "./",
  build: {
    outDir: out,
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        ...Object.fromEntries(
          Object.entries(entries).map(([name, file]) => [
            name,
            join(root, "src", file),
          ]),
        ),
        frame: join(root, "reader-frame.html"),
      },
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(".css"))
            ? "styles.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
// Retain notices for the actual bundled dependency graph, alongside public/licenses.
const packageDirs = new Set();
for (const bundle of Array.isArray(bundled) ? bundled : [bundled]) {
  for (const output of bundle.output)
    if (output.type === "chunk") {
      for (const id of Object.keys(output.modules)) {
        const cleanId = id.replace(/^\0/, "");
        const index = cleanId.lastIndexOf("/node_modules/");
        if (index < 0) continue;
        const parts = cleanId.slice(index + 14).split("/");
        const name = parts[0].startsWith("@")
          ? parts.slice(0, 2).join("/")
          : parts[0];
        packageDirs.add(cleanId.slice(0, index + 14) + name);
      }
    }
}
const notices = [];
for (const directory of packageDirs) {
  const metadata = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  const names = (await readdir(directory)).filter((name) =>
    /^(license|copying|notice)(\.|$)/i.test(name),
  );
  const destination = join(
    out,
    "licenses",
    `${metadata.name.replaceAll("/", "-")}-${metadata.version}`,
  );
  await mkdir(destination, { recursive: true });
  for (const name of names)
    await copyFile(join(directory, name), join(destination, name));
  notices.push(
    `${metadata.name}@${metadata.version}: ${metadata.license ?? "see source notice"}`,
  );
}
await writeFile(
  join(out, "licenses", "bundled-dependencies.txt"),
  notices.sort().join("\n") + "\n",
);
const temporary = await mkdtemp(join(tmpdir(), "anallia-types-"));
try {
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=384",
      join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      join(root, "tsconfig.reader.json"),
      "--outDir",
      temporary,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Public declarations failed");
  // Copy only the declaration graph reachable from public entries; internal
  // renderer declarations and third-party implementation types stay out.
  const copied = new Set();
  async function copyDeclaration(file) {
    file = resolve(file);
    if (copied.has(file)) return;
    copied.add(file);
    if (!file.startsWith(temporary + "/"))
      throw new Error(`Declaration outside build: ${file}`);
    let text = await readFile(file, "utf8");
    // CSS is an explicit asset in the compiled distribution, not a JS import.
    text = text.replace(/^import ["']\.\/styles\.css["'];\s*$/m, "");
    const references = [...text.matchAll(/["'](\.[^"']+\.(?:ts|js))["']/g)].map(
      (match) => match[1],
    );
    for (const ref of references)
      await copyDeclaration(
        resolve(dirname(file), ref.replace(/\.(?:ts|js)$/, ".d.ts")),
      );
    text = text.replace(/(["']\.[^"']+)\.ts(["'])/g, "$1.js$2");
    const target = join(out, "types", relative(temporary, file));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  for (const [name, file] of Object.entries(entries)) {
    const declaration = file.replace(/\.ts$/, ".d.ts");
    await copyDeclaration(join(temporary, declaration));
    await writeFile(
      join(out, `${name}.d.ts`),
      `export * from "./types/${file.replace(/\.ts$/, ".js")}";\n`,
    );
  }
  await copyFile(
    join(root, "examples/consumer/README.md"),
    join(out, "README.md"),
  );
  await copyFile(join(root, "docs/reader-contract.md"), join(out, "reader-contract.md"));
  await copyFile(join(root, "docs/static-content.md"), join(out, "static-content.md"));
  await writeFile(
    join(out, "package.json"),
    JSON.stringify(
      {
        name: "anallia-reader-local",
        version: "0.1.0",
        private: true,
        type: "module",
        exports: {
          "./embedded": { types: "./embedded.d.ts", import: "./embedded.js" },
          "./document": { types: "./document.d.ts", import: "./document.js" },
          "./examples": { types: "./examples.d.ts", import: "./examples.js" },
          "./content": { types: "./content.d.ts", import: "./content.js" },
          "./styles.css": "./styles.css",
          "./reader-frame.html": "./reader-frame.html",
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Static reader distribution ready: dist-reader (${copied.size} declaration files).`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
