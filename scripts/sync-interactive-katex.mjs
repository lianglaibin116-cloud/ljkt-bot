#!/usr/bin/env node
/** Serve KaTeX from this installation so sandboxed classroom widgets work offline. */
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules/katex/dist');
const target = path.join(root, 'public/vendor/interactive-katex');
const echartsSource = path.join(root, 'node_modules/echarts/dist/echarts.min.js');
const echartsTarget = path.join(root, 'public/vendor/interactive/echarts.min.js');

await stat(source);
await mkdir(target, { recursive: true });
for (const asset of ['katex.min.js', 'katex.min.css']) {
  await cp(path.join(source, asset), path.join(target, asset));
}
await cp(path.join(source, 'contrib/auto-render.min.js'), path.join(target, 'auto-render.min.js'));
await cp(path.join(source, 'fonts'), path.join(target, 'fonts'), { recursive: true });
await stat(echartsSource);
await mkdir(path.dirname(echartsTarget), { recursive: true });
await cp(echartsSource, echartsTarget);

console.log('[sync-interactive-katex] Local KaTeX and ECharts assets are ready.');
