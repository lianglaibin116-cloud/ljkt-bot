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
const pendingWindowsLinks = [];
const isWithinDirectory = (directory, candidate) => {
  const pathFromDirectory = relative(directory, candidate);
  return (
    pathFromDirectory === '' ||
    (pathFromDirectory !== '..' &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
};
// pnpm's standalone node_modules can contain absolute symlinks back into
// .next/standalone. Preserve the dependency layout and rewrite those links as
// relative links within the package. Resolving every link to a shared realpath
// breaks peer dependency lookup because Node resolves modules from real paths.
function copyStandaloneEntry(source, target) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(source);
    const resolvedLink = resolve(dirname(source), link);
    if (!isWithinDirectory(standalone, resolvedLink)) {
      throw new Error(`Standalone dependency escaped the runtime: ${source} -> ${link}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    if (process.platform === 'win32') {
      pendingWindowsLinks.push({
        source,
        target,
        resolvedLink,
        isDirectory: statSync(source).isDirectory(),
      });
      return;
    }
    symlinkSync(
      relative(dirname(target), join(packagedServer, relative(standalone, resolvedLink))),
      target,
      statSync(source).isDirectory() ? 'dir' : 'file',
    );
    return;
  }

  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true, mode: stat.mode & 0o777 });
    for (const name of readdirSync(source).sort()) {
      copyStandaloneEntry(join(source, name), join(target, name));
    }
    chmodSync(target, stat.mode & 0o777);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, stat.mode & 0o777);
}
copyStandaloneEntry(standalone, packagedServer);
for (const { source, target, resolvedLink, isDirectory } of pendingWindowsLinks) {
  const realTarget = realpathSync(source);
  if (!isWithinDirectory(standalone, realTarget)) {
    throw new Error(`Standalone dependency escaped the runtime: ${source} -> ${realTarget}`);
  }
  const packagedTarget = join(packagedServer, relative(standalone, realTarget));
  if (isDirectory) symlinkSync(packagedTarget, target, 'junction');
  else copyFileSync(realTarget, target);
}
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
  ['packages/@openmaic/generation/templates', 'packages/@openmaic/generation/templates'],
  ['packages/@openmaic/generation/snippets', 'packages/@openmaic/generation/snippets'],
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
  'packages/@openmaic/generation/templates/requirements-to-outlines/system.md',
  'packages/@openmaic/generation/snippets/interactive-visual-reliability.md',
]) {
  if (!existsSync(join(build, 'server', requiredPrompt))) {
    throw new Error(`Desktop prompt asset missing from standalone package: ${requiredPrompt}`);
  }
}
for (const name of ['main.cjs', 'preload.cjs', 'service.cjs', 'package.json'])
  cpSync(join(root, 'desktop', name), join(build, 'app', name));
cpSync(join(root, 'LICENSE'), join(build, 'app', 'LICENSE'));
console.log(
  `Desktop core ready: ${build}\nApp version: ${JSON.parse(readFileSync(join(build, 'app/package.json'), 'utf8')).version}`,
);
