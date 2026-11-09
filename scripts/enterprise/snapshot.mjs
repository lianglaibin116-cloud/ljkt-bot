import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source recovery only. Never copy env files, provider credentials, browser
// profiles or generated data into a source snapshot.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(root, '.upgrade-backups', `teacher-baseline-${stamp}`);
mkdirSync(target, { recursive: true, mode: 0o700 });
const paths = new Set([
  ...git('diff', '--name-only', '-z', 'HEAD').toString().split('\0'),
  ...git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0'),
]);
const excluded =
  /(^|\/)(\.env[^/]*|server-providers[^/]*\.yml|node_modules|videos|data|logs|\.git|\.upgrade-backups)(\/|$)|\.(pem|key)$/i;
const files = [];
for (const relative of [...paths].filter(Boolean).sort()) {
  if (excluded.test(relative)) continue;
  const source = join(root, relative);
  let stat;
  try {
    stat = lstatSync(source);
  } catch {
    continue;
  }
  if (!stat.isFile()) continue;
  const destination = join(target, 'files', relative);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  files.push({
    path: relative,
    sha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
  });
}
// A manifest records the original HEAD and deletions. Recovery is a reviewed
// copy of selected files, never an automatic checkout/reset of a dirty tree.
const manifest = {
  createdAt: new Date().toISOString(),
  head: git('rev-parse', 'HEAD').toString().trim(),
  status: git('-c', 'core.quotepath=false', 'status', '--short').toString(),
  files,
  limitations:
    'Changed/untracked source files only; excludes credentials, videos and course databases. Keep the recorded Git commit for unchanged files. No automatic restore.',
};
writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
  mode: 0o600,
});
console.log(
  `Source snapshot: ${target}\nFiles captured: ${files.length}\nCredentials and course databases were not copied.`,
);
