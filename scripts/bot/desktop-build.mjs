import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pnpmCli = process.env.npm_execpath;
const rendererResult = spawnSync(
  pnpmCli ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  pnpmCli ? [pnpmCli, 'bot:renderer:build'] : ['bot:renderer:build'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: !pnpmCli && process.platform === 'win32',
  },
);
if (rendererResult.status !== 0) process.exit(rendererResult.status ?? 1);
const result = spawnSync(
  pnpmCli ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  pnpmCli ? [pnpmCli, 'bot:build'] : ['bot:build'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: !pnpmCli && process.platform === 'win32',
    env: { ...process.env, LJKT_BOT_DESKTOP_BUILD: '1' },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const standalone = join(root, '.next/standalone');
if (!existsSync(join(standalone, 'server.js')))
  throw new Error('The desktop build requires a complete Next standalone output.');
const build = join(root, 'desktop/build');
rmSync(build, { recursive: true, force: true });
mkdirSync(join(build, 'app'), { recursive: true });
const packagedServer = join(build, 'server');
const workspaceNodeModules = join(root, 'node_modules');
const copiedEntries = new Set();
const activeEntries = new Set();
const isWithinDirectory = (directory, candidate) => {
  const pathFromDirectory = relative(directory, candidate);
  return (
    pathFromDirectory === '' ||
    (pathFromDirectory !== '..' &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
};
function getPackagedTarget(candidate, source) {
  if (isWithinDirectory(standalone, candidate)) {
    return join(packagedServer, relative(standalone, candidate));
  }
  if (isWithinDirectory(workspaceNodeModules, candidate)) {
    return join(packagedServer, 'node_modules', relative(workspaceNodeModules, candidate));
  }
  throw new Error(`Standalone dependency escaped the workspace runtime: ${source} -> ${candidate}`);
}
// pnpm's standalone node_modules can contain absolute symlinks back into
// .next/standalone or the workspace node_modules store. Mirror only the linked
// workspace package into the packaged runtime, preserving pnpm's virtual-store
// paths so peer dependency lookup continues to work.
function copyStandaloneEntry(source, target) {
  if (isWithinDirectory(standalone, resolve(source))) {
    const relativeSource = relative(standalone, resolve(source)).split(sep).join("/");
    if (/^desktop\/(?:build(?:\/|$)|release(?:\/|-|$))/.test(relativeSource)) return;
  }
  const entryKey = `${resolve(source)}\0${resolve(target)}`;
  if (copiedEntries.has(entryKey) || activeEntries.has(entryKey)) return;
  activeEntries.add(entryKey);
  try {
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(source);
      const resolvedLink = resolve(dirname(source), link);
      const packagedTarget = getPackagedTarget(resolvedLink, source);
      copyStandaloneEntry(resolvedLink, packagedTarget);
      mkdirSync(dirname(target), { recursive: true });
      const isDirectory = statSync(resolvedLink).isDirectory();
      if (process.platform === 'win32' && isDirectory) {
        symlinkSync(packagedTarget, target, 'junction');
      } else if (process.platform === 'win32') {
        copyFileSync(packagedTarget, target);
      } else {
        symlinkSync(
          relative(dirname(target), packagedTarget),
          target,
          isDirectory ? 'dir' : 'file',
        );
      }
      copiedEntries.add(entryKey);
      return;
    }

    if (stat.isDirectory()) {
      mkdirSync(target, { recursive: true, mode: stat.mode & 0o777 });
      for (const name of readdirSync(source).sort()) {
        copyStandaloneEntry(join(source, name), join(target, name));
      }
      chmodSync(target, stat.mode & 0o777);
      copiedEntries.add(entryKey);
      return;
    }

    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    chmodSync(target, stat.mode & 0o777);
  } finally {
    activeEntries.delete(entryKey);
  }
  copiedEntries.add(entryKey);
}
copyStandaloneEntry(standalone, packagedServer);
const packagedServerReal = realpathSync(packagedServer);
const runtimeRequire = createRequire(join(packagedServerReal, 'server.js'));
for (const dependency of ['next', 'next/dist/server/lib/start-server']) {
  const resolved = realpathSync(runtimeRequire.resolve(dependency));
  if (!isWithinDirectory(packagedServerReal, resolved)) {
    throw new Error(`Desktop runtime dependency escaped the package: ${dependency} -> ${resolved}`);
  }
}
for (const [source, target] of [
  ['.next/static', '.next/static'],
  ['public', 'public'],
  // Dynamic filesystem prompt loaders need their Markdown in the packaged
  // server working directory, independent of the source checkout.
  ['lib/prompts', 'lib/prompts'],
  ['packages/@ljkt/generation/templates', 'packages/@ljkt/generation/templates'],
  ['packages/@ljkt/generation/snippets', 'packages/@ljkt/generation/snippets'],
  ['skills', 'skills'],
  [
    'lib/server/agent-runtime/import-pptx-worker.mjs',
    'lib/server/agent-runtime/import-pptx-worker.mjs',
  ],
]) {
  cpSync(join(root, source), join(build, 'server', target), { recursive: true });
}
for (const requiredPrompt of [
  'lib/prompts/templates/interactive-outlines/system.md',
  'lib/prompts/templates/task-engine-outlines/system.md',
  'packages/@ljkt/generation/templates/requirements-to-outlines/system.md',
  'packages/@ljkt/generation/snippets/interactive-visual-reliability.md',
]) {
  if (!existsSync(join(build, 'server', requiredPrompt))) {
    throw new Error(`Desktop prompt asset missing from standalone package: ${requiredPrompt}`);
  }
}
for (const name of [
  'main.cjs',
  'preload.cjs',
  'service.cjs',
  'server-supervisor.cjs',
  'download-manager.cjs',
  'register-ipc.cjs',
  'package.json',
])
  cpSync(join(root, 'desktop', name), join(build, 'app', name));
cpSync(join(root, 'LICENSE'), join(build, 'app', 'LICENSE'));
console.log(
  `Desktop core ready: ${build}\nApp version: ${JSON.parse(readFileSync(join(build, 'app/package.json'), 'utf8')).version}`,
);
