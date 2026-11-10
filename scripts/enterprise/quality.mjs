import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const output = join(root, 'test-results/teacher-quality');
mkdirSync(output, { recursive: true });
const scope = [
  'app/page.tsx',
  'app/api/health/live/route.ts',
  'components/teacher-workspace',
  'components/stage.tsx',
  'components/stage/header-controls.tsx',
  'components/edit/surfaces/quiz/QuestionCard.tsx',
  'components/edit/ScenePageEditor.tsx',
  'components/generation/outlines-editor.tsx',
  'app/generation-preview/page.tsx',
  'lib/hooks/use-scene-generator.ts',
  'lib/pbl/v2/operations/kernel',
  'lib/pbl/v2/operations/runtime/eval-tail-parser.ts',
  'e2e/teacher',
  'tests/quiz/runtime.test.ts',
  'tests/runtime/chat-storage.test.ts',
  'tests/document/local-media-extractor.test.ts',
  'lib/teacher-workspace',
  'lib/config/feature-flags.ts',
  'lib/server/register-node.ts',
  'instrumentation.ts',
  'scripts/enterprise',
  'tests/enterprise',
  'playwright.teacher.config.ts',
  'next.config.ts',
  'proxy.ts',
  'lib/server/route-limits.ts',
  'lib/persistence/request-handler.ts',
  'app/api/persistence/[...path]/route.ts',
  'app/api/agent/owner-events/route.ts',
  'app/api/agent/sessions/[id]/events/route.ts',
  'app/api/materials/route.ts',
  'app/api/generate/course-documents/route.ts',
  'app/api/stages/[id]/course-documents/route.ts',
  'components/course-documents',
  'lib/course-documents',
  'lib/interactive/validate-generated-html.ts',
  'lib/interactive/visual-validation-driver.ts',
  'tests/lib/interactive/validate-generated-html.test.ts',
  'tests/lib/interactive/visual-contract.browser.test.ts',
  'tests/fixtures/interactive-visual-contract.ts',
  'app/api/stages/[id]/freshness/route.ts',
  'app/api/stages/[id]/scenes/route.ts',
  'packages/@ljkt/generation/src/browser.ts',
];
const steps = [
  ['engine-contract', ['scripts/check-node-engine-contract.mjs']],
  ['format', [require.resolve('prettier/bin/prettier.cjs'), ...scope, '--check']],
  [
    'lint',
    [
      join(dirname(require.resolve('eslint/package.json')), 'bin/eslint.js'),
      // The repository deliberately excludes Playwright specs from React lint;
      // they are formatted above and executed by teacher:e2e.
      ...scope.filter((file) => file !== 'e2e/teacher'),
    ],
  ],
  [
    'typecheck',
    [
      '--max-old-space-size=6144',
      require.resolve('typescript/bin/tsc'),
      '--noEmit',
      '--incremental',
      'false',
    ],
  ],
  ['i18n', ['scripts/check-i18n-keys.mjs']],
  [
    'regressions',
    [
      join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
      'run',
      '--maxWorkers=2',
      '--silent=true',
      'tests/enterprise',
      'tests/quiz/runtime.test.ts',
      'tests/runtime/chat-storage.test.ts',
      'tests/document/local-media-extractor.test.ts',
      'tests/config/feature-flags.test.ts',
      'tests/edit',
      'tests/generation',
      'tests/lib/interactive/validate-generated-html.test.ts',
      'tests/course-quality',
      'tests/course-documents',
      'tests/persistence/server-auth.test.ts',
      'tests/persistence/route.test.ts',
      'tests/persistence/stage-access-fidelity.test.ts',
      'tests/agent-runtime/owner-events-route.test.ts',
      'tests/agent-runtime/session-events-route.test.ts',
      'tests/agent-runtime/stage-scenes-route.test.ts',
      'tests/agent-runtime/stage-freshness-route.test.ts',
      'tests/persistence/asset-collector-schedule.test.ts',
      'tests/lib/brand',
      'tests/export/offline-player.test.ts',
      'tests/export/offline-player-collect.test.ts',
    ],
  ],
];
const report = {
  startedAt: new Date().toISOString(),
  scope: 'Local teacher acceptance; not a full production/SaaS certification',
  steps: [],
};
for (const [name, args] of steps) {
  console.log(`[teacher-check] ${name}`);
  let log = '';
  const startedAt = Date.now();
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, TEST_LOAD_LOCAL_ENV: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      log += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      log += chunk.toString();
    });
    child.once('error', (error) => {
      log += error.message;
      done(1);
    });
    child.once('exit', (status) => done(status ?? 1));
  });
  writeFileSync(join(output, `${name}.log`), log);
  report.steps.push({
    name,
    status: code === 0 ? 'passed' : 'failed',
    exitCode: code,
    durationMs: Date.now() - startedAt,
  });
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    `[teacher-check] ${name}: ${code === 0 ? 'PASS' : 'FAIL'} (${Date.now() - startedAt}ms)`,
  );
  if (code !== 0) console.log(log.slice(-12000));
}
process.exitCode = report.steps.some((step) => step.status === 'failed') ? 1 : 0;
console.log(`Report: ${join(output, 'report.json')}`);
