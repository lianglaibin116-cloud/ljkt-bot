import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// All browser state belongs to Playwright's isolated contexts; never touch the
// user's Chrome profile. Block API calls unless explicitly mocked below.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('locale', 'zh-CN');
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health/live') return route.continue();
    if (path === '/api/server-providers')
      return route.fulfill({
        json: {
          success: true,
          providers: {},
          tts: {},
          asr: {},
          pdf: {},
          image: {},
          video: {},
          webSearch: {},
          generation: { parallelSceneConcurrency: 0 },
        },
      });
    if (path.startsWith('/api/stage-meta/'))
      return route.fulfill({ json: { isOwner: true, isPublic: false, generationComplete: true } });
    if (path === '/api/agent/runtime') return route.fulfill({ json: { enabled: false } });
    return route.fulfill({
      status: 503,
      json: { error: 'Live providers disabled in acceptance tests' },
    });
  });
});

async function seedCourse(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('teacher-tasks')).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('maic-documents', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('stages', { keyPath: 'id' });
        const scenes = db.createObjectStore('scenes', { keyPath: ['stageId', 'id'] });
        scenes.createIndex('by-stage', 'stageId');
        db.createObjectStore('outlines', { keyPath: 'stageId' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['stages', 'scenes', 'outlines'], 'readwrite');
        const now = Date.now();
        const id = 'teacher-acceptance-course';
        tx.objectStore('stages').put({
          id,
          name: '初中数学验收课',
          description: '单页修改与互动',
          language: 'zh-CN',
          style: 'professional',
          createdAt: now,
          updatedAt: now,
          dslVersion: '0.1.0',
        });
        tx.objectStore('scenes').put({
          id: 'quiz-page',
          stageId: id,
          type: 'quiz',
          title: '随堂练习',
          order: 1,
          content: {
            type: 'quiz',
            questions: [
              {
                id: 'q1',
                type: 'single',
                question: '哪个是偶数？',
                options: [
                  { label: '2', value: 'A' },
                  { label: '3', value: 'B' },
                ],
                answer: ['A'],
                points: 1,
              },
            ],
          },
          actions: [],
          createdAt: now,
          updatedAt: now,
        });
        tx.objectStore('outlines').put({
          stageId: id,
          outline: { outlines: [], createdAt: now, updatedAt: now },
        });
        tx.objectStore('scenes').put({
          id: 'unchanged-page',
          stageId: id,
          type: 'quiz',
          title: '保留页',
          order: 2,
          content: {
            type: 'quiz',
            questions: [
              {
                id: 'q2',
                type: 'single',
                question: '这一页不应改变',
                options: [{ label: '是', value: 'A' }],
                answer: ['A'],
              },
            ],
          },
          actions: [],
          createdAt: now,
          updatedAt: now,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
}

test('empty library offers creation, material optimization and the course library', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '制作新课件', exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '优化已有课件', exact: false })).toBeVisible();
  await page.getByRole('button', { name: '我的课件', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入课堂', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('teacher-home.png'), fullPage: true });
  await page.getByRole('button', { name: '优化已有课件', exact: false }).click();
  await expect(page.getByRole('heading', { name: '优化已有课件', exact: true })).toBeVisible();
  await expect(page.getByText('请先上传至少一份要优化的课件或教学材料。')).toBeVisible();
  await page.getByRole('button', { name: '返回选择', exact: true }).click();
  await expect(page.getByRole('heading', { name: '优化已有课件', exact: true })).toHaveCount(0);
});

test('choosing a saved course enters the editor, saves one page and returns to teaching', async ({
  page,
}) => {
  await seedCourse(page);
  await page.getByRole('button', { name: '我的课件', exact: true }).click();
  await page.getByRole('button', { name: '搜索课程', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索课程', exact: true });
  await search.fill('不存在');
  await expect(page.getByText('初中数学验收课', { exact: true })).toHaveCount(0);
  await search.fill('初中数学');
  await page.getByText('初中数学验收课', { exact: true }).click();
  await page.getByRole('switch', { name: '编辑本页', exact: true }).click();
  await expect(page.getByTestId('quiz-surface')).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('switch', { name: '返回授课' })).toBeVisible();
  await expect(page).not.toHaveURL(/teacherAction=/);
  const question = page.getByTestId('quiz-question').first();
  await question.getByRole('button', { name: /哪个是偶数/ }).click();
  await question.getByRole('textbox', { name: '题干', exact: true }).fill('修改后的课堂问题');
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          return new Promise<string[]>((resolve, reject) => {
            const request = indexedDB.open('maic-documents', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction('scenes', 'readonly');
              const read = tx
                .objectStore('scenes')
                .index('by-stage')
                .getAll('teacher-acceptance-course');
              read.onsuccess = () => {
                resolve(
                  read.result
                    .sort((a, b) => a.order - b.order)
                    .map((scene) => scene.content.questions[0].question),
                );
              };
              read.onerror = () => reject(read.error);
              tx.oncomplete = () => db.close();
            };
          });
        }),
      { timeout: 15000 },
    )
    .toEqual(['修改后的课堂问题', '这一页不应改变']);
  await page.getByRole('switch', { name: '返回授课' }).click();
  await expect(page.getByRole('switch', { name: '编辑本页' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '开始答题', exact: true }).click();
  await expect(page.getByText('修改后的课堂问题').first()).toBeVisible();
});

test('the course editor adds a quiz page without changing existing pages', async ({ page }) => {
  await seedCourse(page);
  await page.getByRole('button', { name: '我的课件', exact: true }).click();
  await page.getByText('初中数学验收课', { exact: true }).click();
  await page.getByRole('switch', { name: '编辑本页', exact: true }).click();
  await expect(page.getByTestId('quiz-surface')).toBeVisible({ timeout: 45000 });
  await page.getByTestId('slide-nav-insert').last().click();
  await page.getByTestId('scene-type-quiz').click();
  await expect(page.getByTestId('quiz-surface')).toBeVisible();
  await expect(page.getByRole('button', { name: '添加题目', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<{ count: number; originalQuestions: string[] }>((resolve, reject) => {
            const request = indexedDB.open('maic-documents', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const read = db
                .transaction('scenes', 'readonly')
                .objectStore('scenes')
                .index('by-stage')
                .getAll('teacher-acceptance-course');
              read.onsuccess = () => {
                const original = read.result
                  .filter((scene) => ['quiz-page', 'unchanged-page'].includes(scene.id))
                  .sort((a, b) => a.order - b.order);
                resolve({
                  count: read.result.length,
                  originalQuestions: original.map((scene) => scene.content.questions[0].question),
                });
                db.close();
              };
              read.onerror = () => reject(read.error);
            };
          }),
      ),
    )
    .toEqual({ count: 3, originalQuestions: ['哪个是偶数？', '这一页不应改变'] });
});
