import { packager } from '@electron/packager';
import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const build = join(root, 'desktop/build');
const releaseDir = resolve(root, process.env.LJKT_BOT_RELEASE_DIR ?? 'desktop/release');
const isWithinDirectory = (directory, candidate) => {
  const pathFromDirectory = relative(directory, candidate);
  return (
    pathFromDirectory === '' ||
    (pathFromDirectory !== '..' &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
};
if (!existsSync(join(build, 'server/.next/BUILD_ID')))
  throw new Error('Run pnpm bot:desktop:build first.');
for (const name of ['main.cjs', 'preload.cjs', 'service.cjs', 'package.json'])
  cpSync(join(root, 'desktop', name), join(build, 'app', name));
let icon;
if (process.platform === 'darwin') {
  const iconset = join(build, 'lingjing.iconset');
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await sharp(join(root, 'public/lingjing-mark.png'))
        .resize(size * scale, size * scale, { fit: 'contain', background: '#ffffff' })
        .png()
        .toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
    }
  }
  icon = join(build, 'lingjing.icns');
  const result = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', icon], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not build the approved Logo icon.');
} else if (process.platform === 'win32') {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(join(root, 'public/lingjing-mark.png'))
        .resize(size, size, { fit: 'contain', background: '#ffffff' })
        .png()
        .toBuffer(),
    ),
  );
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index];
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  icon = join(build, 'lingjing.ico');
  writeFileSync(icon, Buffer.concat([directory, ...images]));
}
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8'),
).version;
const output = await packager({
  dir: join(build, 'app'),
  out: releaseDir,
  overwrite: true,
  name: '灵境课堂 Bot',
  executableName: 'LingjingBot',
  appBundleId: 'com.boante.lingjing.bot',
  appCopyright: '黑龙江波安特教育科技有限公司；保留上游开源许可与声明',
  electronVersion,
  arch: process.arch,
  platform: process.platform,
  icon,
  extendInfo:
    process.platform === 'darwin'
      ? { NSMicrophoneUsageDescription: '用于教师语音输入、配音录制和课堂语音互动。' }
      : undefined,
  asar: false,
  prune: false,
  extraResource: [join(build, 'server')],
});
const appRoot = output[0];
const resourceRoot =
  process.platform === 'darwin'
    ? join(appRoot, '灵境课堂 Bot.app/Contents/Resources')
    : join(appRoot, 'resources');
const packagedServer = join(resourceRoot, 'server');
// Electron Packager preserves pnpm's dependency links, which can otherwise
// point back into desktop/build. Copy the runtime again and rewrite its links
// without resolving them: peer package lookup relies on pnpm's path structure.
rmSync(packagedServer, { recursive: true, force: true });
const buildServer = join(build, 'server');
function copyBundledEntry(source, target) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(source);
    const resolvedLink = resolve(dirname(source), link);
    if (!isWithinDirectory(buildServer, resolvedLink)) {
      throw new Error(`Bundled dependency escaped the server directory: ${source} -> ${link}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    if (process.platform === 'win32') {
      const realTarget = realpathSync(source);
      if (!isWithinDirectory(buildServer, realTarget)) {
        throw new Error(
          `Bundled dependency escaped the server directory: ${source} -> ${realTarget}`,
        );
      }
      pendingWindowsLinks.push({
        source,
        target,
        realTarget,
        isDirectory: statSync(source).isDirectory(),
      });
      return;
    }
    symlinkSync(
      relative(dirname(target), join(packagedServer, relative(buildServer, resolvedLink))),
      target,
      statSync(source).isDirectory() ? 'dir' : 'file',
    );
    return;
  }

  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true, mode: stat.mode & 0o777 });
    for (const name of readdirSync(source).sort()) {
      copyBundledEntry(join(source, name), join(target, name));
    }
    chmodSync(target, stat.mode & 0o777);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, stat.mode & 0o777);
}
const pendingWindowsLinks = [];
copyBundledEntry(buildServer, packagedServer);
for (const { target, realTarget, isDirectory } of pendingWindowsLinks) {
  const packagedTarget = join(packagedServer, relative(buildServer, realTarget));
  if (isDirectory) symlinkSync(packagedTarget, target, 'junction');
  else copyFileSync(realTarget, target);
}
const runtimeRequire = createRequire(join(packagedServer, 'server.js'));
const resolvedNext = realpathSync(runtimeRequire.resolve('next'));
const packagedServerReal = realpathSync(packagedServer);
if (!isWithinDirectory(packagedServerReal, resolvedNext)) {
  throw new Error(`Packaged Next.js dependency is outside the app bundle: ${resolvedNext}`);
}
console.log(`Desktop application: ${output.join('\n')}`);
