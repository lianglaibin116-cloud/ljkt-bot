import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2];
if (!['dev', 'build', 'start'].includes(mode)) throw new Error('Use bot:dev, bot:build or bot:start.');
const envFile = resolve(root, '.env.local');
const localEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const port = Number(process.env.LJKT_BOT_PORT ?? process.env.PORT ?? localEnv.LJKT_BOT_PORT ?? localEnv.PORT ?? '3010');
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3002].includes(port)) {
  throw new Error('LJKT Bot requires its own port (default 3010); 3000 and 3002 are reserved for the original project.');
}
if (!existsSync(resolve(root, 'node_modules/next/package.json'))) {
  throw new Error('Install dependencies inside ljkt-bot first: pnpm install --frozen-lockfile');
}
const env = { ...process.env, PORT: String(port), LJKT_BOT_PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' };
// Keep the copied teacher workspace and all professional editing controls visible.
const child = spawn(process.execPath, [resolve(root, 'scripts/enterprise/local.mjs'), mode, String(port)], {
  cwd: root, stdio: 'inherit', env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
