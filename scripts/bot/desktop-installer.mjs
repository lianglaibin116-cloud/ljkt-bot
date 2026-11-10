import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.platform !== 'win32') {
  throw new Error('Build the Windows installer on a Windows runner.');
}

const releaseDir = resolve(root, process.env.LJKT_BOT_RELEASE_DIR ?? 'desktop/release');
const portableDir = join(releaseDir, '灵境课堂 Bot-win32-x64');
if (!existsSync(join(portableDir, 'LingjingBot.exe'))) {
  throw new Error('Run pnpm bot:desktop:package on Windows first.');
}

const builderCli = resolve(root, 'node_modules/electron-builder/out/cli/cli.js');
if (!existsSync(builderCli)) throw new Error('Install the pinned electron-builder dependency first.');
const installerDir = join(releaseDir, 'installers');
rmSync(installerDir, { recursive: true, force: true });
mkdirSync(installerDir, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    builderCli,
    '--projectDir',
    root,
    '--config',
    join(root, 'desktop/installer.yml'),
    '--prepackaged',
    portableDir,
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Windows installer build failed: ${result.status}`);
const installers = readdirSync(installerDir).filter((name) => name.endsWith('.exe'));
if (installers.length === 0) throw new Error('electron-builder did not produce an installer.');
console.log(`Windows installer: ${installers.join(', ')}`);
