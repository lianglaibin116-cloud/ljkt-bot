import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const mode = process.argv[2];
if (!['dev', 'build', 'start'].includes(mode)) {
  throw new Error('Use: node scripts/enterprise/local.mjs dev|build|start [port]');
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  throw new Error('Node.js >=22.19.0 is required. Existing configuration was not changed.');
}
const port = Number(process.argv[3] || '3000');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Choose a port between 1024 and 65535.');
}
if (mode === 'start' && !existsSync(join(root, '.next/BUILD_ID'))) {
  throw new Error('No production build. Run pnpm teacher:build first.');
}
const profilePath = join(root, '.next/teacher-profile.json');
if (mode === 'start') {
  let profile;
  try {
    profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    /* fail closed below */
  }
  const buildId = readFileSync(join(root, '.next/BUILD_ID'), 'utf8').trim();
  if (
    profile?.state !== 'ready' ||
    profile?.profile !== 'teacher-local' ||
    profile?.buildId !== buildId
  ) {
    throw new Error(
      'This bundle was not verified as a teacher build. Run pnpm teacher:build; setting a browser flag only at startup is not sufficient.',
    );
  }
}
if (mode === 'build') {
  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, JSON.stringify({ state: 'building', profile: 'teacher-local' }));
}
if (mode !== 'build') {
  await new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', (error) =>
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Port ${port} is occupied. No process was stopped and no alternate port was selected.`
            : `Cannot bind the local acceptance port (${error.code || 'unknown error'}). No process was stopped.`,
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(done));
  });
}
console.log(
  mode === 'build'
    ? 'Building the local teacher acceptance profile (not a public SaaS release).'
    : `Teacher acceptance: http://localhost:${port} — loopback only; existing .env.local remains unchanged.`,
);
const args =
  mode === 'build'
    ? ['build', '--webpack']
    : [mode, '--hostname', '127.0.0.1', '--port', String(port)];
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...args], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Next's normal .env loading still provides the user's provider settings.
    // This explicit profile changes only UI affordances, never credentials.
    NEXT_PUBLIC_TEACHER_WORKSPACE_ENABLED: '1',
    OPENMAIC_LOCAL_ACCEPTANCE: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6144',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (mode === 'build' && code === 0) {
    writeFileSync(
      profilePath,
      JSON.stringify(
        {
          state: 'ready',
          profile: 'teacher-local',
          buildId: readFileSync(join(root, '.next/BUILD_ID'), 'utf8').trim(),
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  }
  process.exitCode = code ?? (signal ? 1 : 0);
});
