import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { get } from "node:http";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { runGuarded } from "./run-guarded.mjs";

if (!process.argv.includes("--run")) {
  runGuarded(process.execPath, ["--max-old-space-size=256", fileURLToPath(import.meta.url), "--run"], { memoryMiB: 1024, seconds: 45 });
} else {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const address = Object.values(networkInterfaces()).flat().find(entry => entry?.family === "IPv4" && !entry.internal)?.address;
  for (const [mode, port] of [["dev", 5173], ["preview", 4173]]) {
    const args = ["--max-old-space-size=192", "node_modules/vite/bin/vite.js", ...(mode === "preview" ? ["preview"] : []), "--host", "0.0.0.0", "--port", String(port), "--strictPort"];
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const pipe of [child.stdout, child.stderr]) pipe.on("data", data => { output = (output + data).slice(-8192); });
    const exited = once(child, "exit");
    try {
      const started = Date.now();
      let response;
      while (Date.now() - started < 10000) {
        if (child.exitCode !== null) throw new Error(`${mode} could not start: ${output}`);
        if (!/Local:/.test(output)) { await pause(50); continue; }
        try { response = await fetch(`http://127.0.0.1:${port}/`); break; } catch { await pause(50); }
      }
      assert.ok(response?.ok, `${mode} did not serve its index`);
      const html = await response.text();
      const asset = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
      assert.ok(asset, `${mode} has no module entry`);
      assert.ok((await fetch(new URL(asset, response.url))).ok, `${mode} module entry failed`);
      if (address) assert.ok((await fetch(`http://${address}:${port}/`)).ok, `${mode} did not accept the LAN address`);
      const blockedStatus = await new Promise((resolve, reject) => {
        get(`http://127.0.0.1:${port}/`, { headers: { Host: "blocked.invalid" } }, result => { result.resume(); resolve(result.statusCode); }).on("error", reject);
      });
      assert.equal(blockedStatus, 403, `${mode} Host checking was disabled`);
      const conflict = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let conflictOutput = "";
      for (const pipe of [conflict.stdout, conflict.stderr]) pipe.on("data", data => { conflictOutput = (conflictOutput + data).slice(-8192); });
      const [code] = await once(conflict, "exit");
      assert.notEqual(code, 0, `${mode} silently accepted the occupied port`);
      assert.match(conflictOutput, /already in use/);
      assert.ok((await fetch(`http://127.0.0.1:${port}/`)).ok, "the first server must remain running");
      console.log(`${mode}: 0.0.0.0:${port}, index, module, ${address ? "same-host LAN address" : "LAN interface unavailable"}, Host rejection and strict-port collision verified`);
    } finally {
      child.kill("SIGTERM");
      await exited;
    }
  }
}
