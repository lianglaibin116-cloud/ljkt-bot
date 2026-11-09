import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOfflinePlayerHtml } from '@/lib/export/offline-player/html';
import { prepareOfflineInteraction } from '@/lib/export/offline-player/bridge';

// Explicit opt-in: exercises actual file:// loading, without a web server.
describe.skipIf(process.env.OFFLINE_PLAYER_BROWSER !== '1')('USB player in Chromium', () => {
  let browser: Browser;
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'offline-classroom-'));
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--disable-crash-reporter', '--disable-crashpad'],
    });
  }, 30000);
  afterAll(async () => {
    await browser?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 30000);
  it('plays locally, freezes interaction timers, confirms all quiz types and keeps page state', async () => {
    // A short PCM WAV, embedded just like previously generated narration.
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(16000, 40);
    const audio = 'data:audio/wav;base64,' + wav.toString('base64');
    const image =
      'data:image/svg+xml;base64,' +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#e9eefc"/><text x="100" y="220" font-size="64">USB classroom</text></svg>',
      ).toString('base64');
    const html = buildOfflinePlayerHtml({
      title: '离线课堂验收',
      pages: [
        {
          id: 'slide',
          title: '知识讲解',
          kind: 'slide',
          image,
          ratio: 0.5625,
          narration: [{ text: '讲解内容', src: audio }],
          boards: [{ image, ratio: 0.5625 }],
        },
        {
          id: 'interactive',
          title: '操作实验',
          kind: 'interactive',
          narration: [],
          html: prepareOfflineInteraction(`<!doctype html><html><head><style>#box{width:80px;height:80px;background:purple;animation:pulse 1s infinite alternate}@keyframes pulse{to{transform:translateX(80px)}}</style></head><body>
        <h1>操作实验</h1><div id="box"></div><output id="ticks">0</output><button id="pick" onclick="this.textContent='已选择 A'">选择 A</button>
        <script>var n=0;setInterval(function(){document.getElementById('ticks').textContent=String(++n);},50);</script></body></html>`),
        },
        {
          id: 'quiz',
          title: '课堂练习',
          kind: 'quiz',
          narration: [],
          questions: [
            {
              id: 'q1',
              type: 'single',
              question: '单选题',
              options: [
                { value: 'A', label: '选项一' },
                { value: 'B', label: '选项二' },
              ],
              answer: ['B'],
              analysis: '选择二。',
            },
            {
              id: 'q2',
              type: 'multiple',
              question: '多选题',
              options: [
                { value: 'A', label: '选项一' },
                { value: 'B', label: '选项二' },
              ],
              answer: ['A', 'B'],
            },
            {
              id: 'q3',
              type: 'short_answer',
              question: '简答题',
              answer: ['讲清理由'],
              analysis: '教师点评',
            },
          ],
        },
      ],
    });
    const path = join(directory, '开始授课.html');
    await writeFile(path, html);
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(path).href);
    await page.locator('#start').click();
    await browserExpect(page.locator('#counter')).toHaveText('1 / 3');
    expect(
      await page.locator('.slide-canvas img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBe(1600);
    await page.locator('#narrate').click();
    await browserExpect(page.locator('#caption')).toHaveText('讲解内容');
    await browserExpect(page.locator('#status'))
      .toContainText('本页讲解结束', { timeout: 15000 })
      .catch(async (error) => {
        console.log(
          await page
            .locator('#lesson-audio')
            .evaluate((a: HTMLAudioElement) => ({
              readyState: a.readyState,
              paused: a.paused,
              ended: a.ended,
              duration: a.duration,
              time: a.currentTime,
              error: a.error?.message,
            })),
        );
        throw error;
      });
    await browserExpect(page.locator('#counter')).toHaveText('1 / 3');
    await page.locator('#board').click();
    await browserExpect(page.locator('#board-view')).toBeVisible();
    await page.locator('#board-view').click();
    await page.locator('#next').click();
    const frame = page.frameLocator('iframe');
    await frame.locator('#pick').click();
    await page.locator('#pause').click();
    await page.waitForTimeout(150);
    const ticks = await frame.locator('#ticks').textContent();
    await page.waitForTimeout(250);
    expect(await frame.locator('#ticks').textContent()).toBe(ticks);
    await page.locator('#resume').click();
    await browserExpect(frame.locator('#ticks')).not.toHaveText(ticks!);
    await page.locator('#next').click();
    await browserExpect(page.getByRole('button', { name: '确认答案', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'B 选项二' }).click();
    await page.getByRole('button', { name: '确认答案', exact: true }).click();
    await browserExpect(page.locator('.feedback')).toContainText('回答正确');
    await page.getByRole('button', { name: '下一题', exact: true }).click();
    await page.getByRole('button', { name: 'A 选项一' }).click();
    await page.getByRole('button', { name: 'B 选项二' }).click();
    await page.getByRole('button', { name: '确认答案', exact: true }).click();
    await browserExpect(page.locator('.feedback')).toContainText('回答正确');
    await page.getByRole('button', { name: '下一题', exact: true }).click();
    await page.getByLabel('填写答案').fill('我的解释');
    await page.getByRole('button', { name: '确认答案', exact: true }).click();
    await browserExpect(page.locator('.feedback')).toContainText('由教师判断');
    await page.screenshot({
      path: process.env.OFFLINE_PLAYER_SCREENSHOT || join(directory, 'quiz.png'),
    });
    await page.locator('#previous').click();
    await browserExpect(frame.locator('#pick')).toHaveText('已选择 A');
    await page.locator('#next').click();
    await browserExpect(page.getByLabel('填写答案')).toHaveValue('我的解释');
    await page.keyboard.press('PageUp');
    await browserExpect(page.locator('#counter')).toHaveText('2 / 3');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#replay').click();
    await browserExpect(frame.locator('#pick')).toHaveText('选择 A');
    await page.locator('#blackout').click();
    await browserExpect(page.locator('#black-screen')).toBeVisible();
    await page.locator('#black-screen').click();
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, 30000);
});
