import { fileURLToPath } from "node:url";
import { runGuarded } from "./run-guarded.mjs";
runGuarded("/usr/bin/env", [`SHUYRA_PERF=${process.env.SHUYRA_PERF === "1" ? "1" : "0"}`, `SHUYRA_EXPORT_ROOT=${process.env.SHUYRA_EXPORT_ROOT ?? ""}`, `SHUYRA_CPU_PROFILE=${process.env.SHUYRA_CPU_PROFILE === "1" ? "1" : "0"}`, process.execPath, "--max-old-space-size=384", fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)), "test", ...process.argv.slice(2)], { memoryMiB: 3072, seconds: 110, cpuQuota: 150 });
