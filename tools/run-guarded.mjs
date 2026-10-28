import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export function runGuarded(command, args, { memoryMiB = 1024, seconds = 120, cpuQuota } = {}) {
  if (!Number.isInteger(memoryMiB) || memoryMiB < 128 || memoryMiB > 4096 || !Number.isInteger(seconds) || seconds < 1 || seconds > 600)
    throw new Error("Invalid guarded execution budget");
  const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.()}`;
  const env = { ...process.env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus` };
  if (process.platform !== "linux" || !existsSync(`${runtime}/bus`)) {
    console.error("Guarded checks require a Linux user systemd session; refusing to run without a process-group memory limit.");
    process.exitCode = 1;
    return;
  }
  const unit = `shuyra-check-${process.pid}-${Date.now()}`;
  const properties = [
    `MemoryMax=${memoryMiB}M`, "MemorySwapMax=0", `RuntimeMaxSec=${seconds}s`,
    "KillMode=control-group", "TasksMax=256", "LimitCORE=0",
    ...(cpuQuota ? [`CPUQuota=${cpuQuota}%`] : []),
  ];
  const child = spawn("systemd-run", [
    "--user", "--quiet", "--collect", "--wait", "--pipe", `--unit=${unit}`,
    ...properties.map(value => `--property=${value}`),
    `--working-directory=${process.cwd()}`, command, ...args,
  ], { stdio: "inherit", env });
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    spawn("systemctl", ["--user", "stop", `${unit}.service`], { env, stdio: "ignore" });
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode ??= code ?? 1; });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const split = process.argv.indexOf("--");
  if (split < 0 || !process.argv[split + 1]) throw new Error("Expected --memory=MiB --seconds=N -- command args");
  const memoryMiB = Number(process.argv.slice(2, split).find(arg => arg.startsWith("--memory="))?.slice(9) ?? 1024);
  const seconds = Number(process.argv.slice(2, split).find(arg => arg.startsWith("--seconds="))?.slice(10) ?? 120);
  runGuarded(process.argv[split + 1], process.argv.slice(split + 2), { memoryMiB, seconds });
}
