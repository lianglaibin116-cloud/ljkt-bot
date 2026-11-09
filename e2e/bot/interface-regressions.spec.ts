import { test, expect, type Page } from '@playwright/test';

async function seedConversation(page: Page, withTask: boolean) {
  await page.goto('/bot');
  await page.evaluate(
    async ({ withTask }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('ljkt-bot-conversations', 10);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore('threads', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('threads', 'readwrite');
          tx.objectStore('threads').put({
            id: 'interface-regression',
            title: 'C++课程制作测试',
            createdAt: 1,
            updatedAt: Date.now(),
            messages: [
              {
                id: 'long-reply',
                role: 'assistant',
                content: Array.from(
                  { length: 65 },
                  (_, i) => `### 知识点 ${i + 1}\n\n认识变量、输入输出和循环，理解程序执行过程。\n`,
                ).join('\n'),
                status: 'complete',
                actions: withTask
                  ? [
                      {
                        id: 'prepare',
                        action: {
                          type: 'prepare-course',
                          title: 'C++基础测试课程',
                          requirement: '初中C++基础，三页，先审阅大纲。',
                          interactive: false,
                          teacherDemo: true,
                        },
                      },
                    ]
                  : [],
              },
            ],
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { withTask },
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '新建对话' })).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'zh-CN'));
  await page.route('**/api/server-providers', (route) =>
    route.fulfill({
      json: {
        success: true,
        providers: { minimax: { models: ['MiniMax-M3'] } },
        tts: {},
        asr: {},
        pdf: {},
        image: {},
        video: {},
        webSearch: {},
        generation: { parallelSceneConcurrency: 0 },
      },
    }),
  );
});

test('long conversation scrolls inside its pane and keeps header and composer visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedConversation(page, false);
  const timeline = page.locator('.ljbot-timeline');
  const dimensions = await timeline.evaluate((node) => ({
    height: node.clientHeight,
    full: node.scrollHeight,
    windowHeight: innerHeight,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.height).toBeLessThan(dimensions.windowHeight);
  expect(dimensions.full).toBeGreaterThan(dimensions.height + 300);
  expect(dimensions.documentHeight).toBeLessThanOrEqual(dimensions.windowHeight + 2);
  await timeline.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const before = await timeline.evaluate((node) => node.scrollTop);
  await timeline.hover();
  await page.mouse.wheel(0, -600);
  await expect.poll(() => timeline.evaluate((node) => node.scrollTop)).toBeLessThan(before - 100);
  await expect(page.locator('.ljbot-topbar')).toBeInViewport();
  await expect(page.getByRole('textbox', { name: '发送给灵境 Bot' })).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('prepare task hands requirements to the right pane and displays reviewed outlines', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window === window.top) return;
    // A real asynchronous settings store must not be treated as an empty config.
    const open = indexedDB.open.bind(indexedDB);
    const handler = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
      const request = open(...args);
      Object.defineProperty(request, 'onsuccess', {
        configurable: true,
        get() {
          return handler.get!.call(request);
        },
        set(callback) {
          handler.set!.call(
            request,
            callback
              ? (event: Event) => setTimeout(() => callback.call(request, event), 900)
              : null,
          );
        },
      });
      return request;
    }) as IDBFactory['open'];
  });
  const requests: Array<{ model?: string; requirement?: string }> = [];
  const outlines = [
    {
      id: 'outline-1',
      type: 'slide',
      title: '认识C++程序',
      description: '从输出语句开始',
      keyPoints: ['程序结构', '标准输出'],
      order: 1,
    },
    {
      id: 'outline-2',
      type: 'slide',
      title: '变量与输入',
      description: '认识变量',
      keyPoints: ['整数', '输入'],
      order: 2,
    },
    {
      id: 'outline-3',
      type: 'quiz',
      title: '随堂检验',
      description: '检查理解',
      keyPoints: ['结果预测'],
      order: 3,
      quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
    },
  ];
  await page.route('**/api/generate/scene-outlines-stream', async (route) => {
    const body = route.request().postDataJSON();
    requests.push({
      model: route.request().headers()['x-model'],
      requirement: body.requirements?.requirement,
    });
    const events = [
      ...outlines.map((data) => ({ type: 'outline', data })),
      { type: 'done', outlines, languageDirective: '使用中文教学', courseTitle: 'C++基础测试课程' },
    ];
    await route.fulfill({
      contentType: 'text/event-stream',
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    });
  });
  // This regression must never call a real provider or generate paid media.
  await page.route('**/api/generate/scene-content', (route) =>
    route.fulfill({ status: 503, json: { error: 'Do not generate before outline approval' } }),
  );
  await seedConversation(page, true);
  await expect(page.locator('.ljbot-model')).toContainText('MiniMax-M3');
  await page.getByRole('button', { name: '开始整理大纲', exact: true }).click();
  await expect.poll(() => requests.length, { timeout: 15000 }).toBe(1);
  expect(requests[0]).toEqual({
    model: 'minimax:MiniMax-M3',
    requirement: '初中C++基础，三页，先审阅大纲。',
  });
  const frame = page.frameLocator('iframe[title="课件预览和编辑"]');
  await expect(frame.locator('textarea').first()).toHaveValue('认识C++程序');
  await expect(frame.locator('textarea').first()).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(
    frame
      .locator('textarea')
      .filter({ hasText: '变量与输入' })
      .or(frame.getByText('变量与输入', { exact: true })),
  ).toBeVisible();
});

test('failed outline stays visible, keeps its own draft and can be restarted from the task card', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('**/api/generate/scene-outlines-stream', async (route) => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({ status: 503, json: { error: '模型服务暂时不可用，请重试' } });
    const outlines = [
      {
        id: 'retry-outline',
        type: 'slide',
        title: '重试后可审阅的大纲',
        description: 'C++基础',
        keyPoints: ['标准输出'],
        order: 1,
      },
    ];
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'done', outlines, languageDirective: '中文' })}\n\n`,
    });
  });
  await seedConversation(page, true);
  await expect(page.locator('.ljbot-model')).toContainText('MiniMax-M3');
  await page.getByRole('button', { name: '开始整理大纲', exact: true }).click();
  const frame = page.frameLocator('iframe[title="课件预览和编辑"]');
  await expect(frame.getByText('模型服务暂时不可用，请重试', { exact: true })).toBeVisible();
  const firstSrc = await page.locator('iframe[title="课件预览和编辑"]').getAttribute('src');
  const firstSession = new URL(firstSrc!, 'http://localhost:3012').searchParams.get('botSession')!;
  expect(
    await page.evaluate(
      (id) => !!sessionStorage.getItem('ljkt-bot:generation:' + id),
      firstSession,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '开始整理大纲', exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(frame.locator('textarea').first()).toHaveValue('重试后可审阅的大纲');
  await expect(frame.locator('textarea').first()).toBeInViewport();
});
