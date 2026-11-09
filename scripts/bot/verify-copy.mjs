import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/source-baseline/copy-manifest.json'), 'utf8'));
const modified = new Set(manifest.derived_files);
let failures = 0, checked = 0;
for (const item of manifest.files) {
  if (modified.has(item.path)) continue;
  const file = resolve(root, item.path);
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error('Symbolic link is not allowed');
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (digest !== item.source_sha256) throw new Error('File differs from the recorded source snapshot');
    checked++;
  } catch (error) { console.error(item.path + ': ' + error.message); failures++; }
}
console.log(JSON.stringify({ checked, intentionallyDerived: modified.size, failures }));
process.exitCode = failures ? 1 : 0;
