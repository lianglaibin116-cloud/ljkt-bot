import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const courseId = 'course-document-e2e';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'zh-CN'));
  let teacherGenerations = 0;
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
    if (path === '/api/generate/course-documents') {
      const body = route.request().postDataJSON();
      const teacher = body.kind === 'teacher-plan';
      if (teacher) teacherGenerations++;
      const document = {
        schemaVersion: 1,
        stageId: courseId,
        kind: body.kind,
        generatedAt: Date.now(),
        sourceFingerprint: createHash('sha256').update(JSON.stringify(body.source)).digest('hex'),
        title: teacher
          ? teacherGenerations > 1
            ? '勾股定理新版课程计划'
            : '勾股定理教师课程计划'
          : '勾股定理学生课堂笔记',
        sections: [
          {
            id: 'knowledge',
            title: teacher ? '目标和核心知识' : '定理 适用条件和方法',
            content:
              '仅用于直角三角形。\n\n$$a^2+b^2=c^2$$\n\n| 直角边 a | 直角边 b | 斜边 c |\n|---|---|---|\n| 3 | 4 | 5 |\n\n1. 先判断直角。\n2. 平方、相加，再开平方。',
            sourceSceneIds: ['quiz-page'],
          },
          ...(teacher
            ? [
                {
                  id: 'sequence',
                  title: '授课顺序与课堂检查',
                  content: '先观察面积关系，再计算斜边，最后完成随堂练习。',
                  sourceSceneIds: ['quiz-page', 'unchanged-page'],
                },
              ]
            : [
                {
                  id: 'answers',
                  title: '随堂测验 答案与解析',
                  content:
                    '**答案：** A. 5。\n\n**解析：** $3^2+4^2=25$，斜边为5。\n\n```python\ndef hypotenuse(a, b):\n    return (a*a + b*b) ** 0.5\n```',
                  sourceSceneIds: ['quiz-page', 'unchanged-page'],
                },
              ]),
        ],
        warnings: [],
      };
      return route.fulfill({
        contentType: 'text/event-stream',
        body: `event: progress\ndata: {"current":1,"total":1}\n\nevent: complete\ndata: ${JSON.stringify({ document })}\n\n`,
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: 'Live providers disabled in acceptance tests' },
    });
  });
});

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async (id) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('maic-documents', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('stages', { keyPath: 'id' });
        db.createObjectStore('scenes', { keyPath: ['stageId', 'id'] }).createIndex(
          'by-stage',
          'stageId',
        );
        db.createObjectStore('outlines', { keyPath: 'stageId' });
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['stages', 'scenes', 'outlines'], 'readwrite');
        const now = Date.now();
        tx.objectStore('stages').put({
          id,
          name: '勾股定理验收课',
          createdAt: now,
          updatedAt: now,
          languageDirective: '使用中文',
          dslVersion: '0.1.0',
        });
        for (const [index, pageId] of ['quiz-page', 'unchanged-page'].entries())
          tx.objectStore('scenes').put({
            id: pageId,
            stageId: id,
            order: index + 1,
            title: index ? '适用条件' : '勾股定理练习',
            type: 'quiz',
            content: {
              type: 'quiz',
              questions: [
                {
                  id: `q${index}`,
                  type: 'single',
                  question: index ? '勾股定理适用于哪种三角形？' : '直角边分别为3、4，斜边为多少？',
                  options: [
                    { value: 'A', label: index ? '直角三角形' : '5' },
                    { value: 'B', label: index ? '任意三角形' : '7' },
                  ],
                  answer: ['A'],
                  analysis: '确认直角条件后计算。',
                },
              ],
            },
            actions: [],
            createdAt: now,
            updatedAt: now,
          });
        tx.objectStore('outlines').put({
          stageId: id,
          outline: { outlines: [], generationComplete: true, createdAt: now, updatedAt: now },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, courseId);
  await page.goto(`/classroom/${courseId}`);
  await expect(page.getByTestId('course-documents-open')).toBeVisible({ timeout: 60000 });
}

test('teacher edits persist, candidates require adoption, previous versions restore, and course content stays unchanged', async ({
  page,
}, info) => {
  await seed(page);
  await page.getByTestId('course-documents-open').click();
  const panel = page.getByTestId('course-documents-panel');
  await panel.getByTestId('course-document-generate').click();
  await expect(
    panel.getByRole('heading', { name: '勾股定理教师课程计划', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: '编辑', exact: true }).click();
  await panel.getByRole('textbox', { name: '资料标题', exact: true }).fill('老师校订后的课程计划');
  await panel
    .getByRole('textbox', { name: '章节正文 1', exact: true })
    .fill('先确认直角，再用 $a^2+b^2=c^2$。\n\n重点提醒：斜边必须与直角对应。');
  await panel.getByTestId('course-document-save').click();
  await expect(
    panel.getByRole('heading', { name: '老师校订后的课程计划', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByTestId('course-documents-open').click();
  await expect(
    panel.getByRole('heading', { name: '老师校订后的课程计划', exact: true }),
  ).toBeVisible();
  await panel.getByTestId('course-document-generate').click();
  await expect(panel.getByRole('button', { name: '查看新稿', exact: true })).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: '老师校订后的课程计划', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: '查看新稿', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: '勾股定理新版课程计划', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: '采用新稿', exact: true }).click();
  await expect(panel.getByRole('button', { name: '恢复上一版', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '恢复上一版', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: '老师校订后的课程计划', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('teacher-plan.png') });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('switch', { name: '编辑本页', exact: true }).click();
  await expect(page.getByTestId('quiz-surface')).toBeVisible({ timeout: 45000 });
  await expect(page.getByTestId('course-documents-open')).toHaveCount(1);
  await expect(page.getByTestId('course-documents-open')).toBeVisible();
  const question = page.getByTestId('quiz-question').first();
  await question.getByRole('button', { name: /直角边分别/ }).click();
  await question.getByRole('textbox', { name: '题干', exact: true }).fill('老师更新后的例题');
  await page.getByTestId('course-documents-open').click();
  await expect(
    panel.getByText('课件已更新，可重新整理；当前修改稿仍保留。', { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: '老师校订后的课程计划', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await page.getByRole('menuitem', { name: /导出为 HTML/ }).hover();
  await expect(page.getByRole('menuitem', { name: /包含旁白和视频/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /不含旁白/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test('student notes render formulas, tables and answers and export the saved Word and isolated PDF view', async ({
  page,
}, info) => {
  await seed(page);
  await page.getByTestId('course-documents-open').click();
  const panel = page.getByTestId('course-documents-panel');
  await panel.getByTestId('course-document-tab-student-notes').click();
  await panel.getByTestId('course-document-generate').click();
  await expect(
    panel.getByRole('heading', { name: '勾股定理学生课堂笔记', exact: true }),
  ).toBeVisible();
  await expect(panel.locator('.katex').first()).toBeVisible();
  await expect(panel.locator('table')).toBeVisible();
  await expect(panel.getByText('A. 5。', { exact: false }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '下载 Word', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/学生课堂笔记\.docx$/);
  await download.saveAs(info.outputPath('student-notes.docx'));
  const zip = await JSZip.loadAsync(await readFile(info.outputPath('student-notes.docx')));
  const wordXml = await zip.file('word/document.xml')!.async('string');
  expect(wordXml).toContain('<m:oMath');
  expect(wordXml).toMatch(/def hypotenuse[\s\S]*?<\/w:p>[\s\S]*?return/);
  await page.screenshot({ path: info.outputPath('student-notes.png') });
  await page.evaluate(() => {
    const capture = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node instanceof HTMLIFrameElement && node.title === '勾股定理学生课堂笔记') {
            (window as unknown as { coursePrintHtml: string }).coursePrintHtml = node.srcdoc;
            capture.disconnect();
          }
        }
    });
    capture.observe(document.body, { childList: true });
  });
  await panel.getByRole('button', { name: '打印 / 另存为 PDF', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { coursePrintHtml?: string }).coursePrintHtml),
    )
    .toBeTruthy();
  const printHtml = await page.evaluate(
    () => (window as unknown as { coursePrintHtml: string }).coursePrintHtml,
  );
  expect(printHtml).toContain('size:A4');
  expect(printHtml).not.toContain('course-documents-panel');
  const printPage = await page.context().newPage();
  await printPage.goto(new URL('/api/health/live', page.url()).href);
  await printPage.setContent(printHtml.replace('<head>', `<head><base href="${page.url()}">`), {
    waitUntil: 'networkidle',
  });
  await printPage.evaluate(() => document.fonts.ready);
  await printPage.pdf({
    path: info.outputPath('student-notes.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  await printPage.close();
});
