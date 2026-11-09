import { test, expect } from '@playwright/test';

test('Grok-style shell, Bot-native course library, model setup and persistent conversation', async ({
  page,
}) => {
  await page.goto('/bot');
  await expect(page.getByRole('heading', { name: /今天，想把什么/ })).toBeVisible();
  await expect(page.locator('.ljbot-brand img')).toHaveAttribute('src', '/lingjing-mark.png');
  await page.getByRole('button', { name: '我的课件', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '我的课件' })).toBeVisible();
  await expect(page.getByText('在 Bot 内搜索、整理、导入和恢复课件')).toBeVisible();
  await page.getByRole('button', { name: '关闭课件库' }).click();
  await page.getByRole('textbox', { name: '发送给灵境 Bot' }).fill('帮助我备课');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // No configured model: never fabricate an assistant response.
  await expect(page.locator('.ljbot-message-assistant')).toHaveCount(0);
});

test('restores saved conversation, course actions and stopped streams', async ({ page }) => {
  await page.goto('/bot');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('ljkt-bot-conversations', 10);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('threads')) {
          const store = req.result.createObjectStore('threads', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('threads', 'readwrite');
        tx.objectStore('threads').put({
          id: 'persisted-test',
          title: '恢复测试',
          createdAt: 1,
          updatedAt: Date.now(),
          messages: [
            {
              id: 'a1',
              role: 'assistant',
              content: '上次对话的内容',
              status: 'streaming',
              actions: [{ id: 'action1', action: { type: 'open-workspace' } }],
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
  });
  await page.reload();
  await expect(page.getByText('上次对话的内容')).toBeVisible();
  await expect(page.getByText('上次回复已中断，可继续提问。')).toBeVisible();
  await expect(page.getByRole('button', { name: '返回 Bot 对话', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回 Bot 对话', exact: true }).click();
  await expect(page.getByText('上次对话的内容')).toBeVisible();
  await page.getByRole('button', { name: '新建对话' }).click();
  await expect(page.getByRole('heading', { name: /今天，想把什么/ })).toBeVisible();
  await page.getByRole('button', { name: '恢复测试', exact: true }).click();
  await expect(page.getByText('上次对话的内容')).toBeVisible();
});

test('real API keeps desktop loopback aliases same-origin and rejects unrelated origins', async ({
  request,
}) => {
  for (const host of ['localhost:3012', '127.0.0.1:3012']) {
    const result = await request.post('/api/bot/chat', {
      headers: { Host: host, Origin: `http://${host}` },
      data: {},
    });
    expect(result.status()).toBe(400);
  }
  const unrelated = await request.post('/api/bot/chat', {
    headers: { Origin: 'https://unrelated.example' },
    data: {},
  });
  expect(unrelated.status()).toBe(403);
});
