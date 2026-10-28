import { fileURLToPath } from "node:url";
import { runGuarded } from "./run-guarded.mjs";
runGuarded(process.execPath, ["--max-old-space-size=384", fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)), "test", ...process.argv.slice(2)], { memoryMiB: 3072, seconds: 110, cpuQuota: 150 });
