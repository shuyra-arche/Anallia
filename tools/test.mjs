import { readdirSync } from "node:fs";
import { runGuarded } from "./run-guarded.mjs";
const files = process.argv.slice(2);
if (!files.length) files.push(...readdirSync("tests").filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/${name}`));
runGuarded(process.execPath, ["--max-old-space-size=256", "--experimental-strip-types", "--test", "--test-concurrency=1", "--test-timeout=15000", ...files]);
