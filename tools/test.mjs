import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) files.push(...readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/${name}`));
const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.()}`;
const unit = `shuyra-tests-${process.pid}-${Date.now()}`;
const env = { ...process.env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus` };
if (process.platform !== 'linux' || !existsSync(`${runtime}/bus`)) {
  console.error('The guarded test runner requires a Linux user systemd session; refusing to run without a process-group memory limit.');
  process.exit(1);
}
const child = spawn('systemd-run', [
  '--user', '--quiet', '--collect', '--wait', '--pipe', `--unit=${unit}`,
  '--property=MemoryMax=1G', '--property=MemorySwapMax=0',
  '--property=RuntimeMaxSec=120s', '--property=KillMode=control-group',
  '--property=TasksMax=128', '--property=LimitCORE=0',
  `--working-directory=${process.cwd()}`, process.execPath,
  '--max-old-space-size=256', '--experimental-strip-types', '--test',
  '--test-concurrency=1', '--test-timeout=15000', ...files,
], { stdio: 'inherit', env });
let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  spawn('systemctl', ['--user', 'stop', `${unit}.service`], { env, stdio: 'ignore' });
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode ??= code ?? 1; });
