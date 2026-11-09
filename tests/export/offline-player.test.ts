import { describe, it, expect, vi } from 'vitest';
import { buildOfflineLesson, type OfflineCollector } from '@/lib/export/offline-player/build';
import { buildOfflinePlayerHtml } from '@/lib/export/offline-player/html';
import { buildResourcePackZip } from '@/lib/export/use-export-pptx';
import type { Scene } from '@/lib/types/stage';
import JSZip from 'jszip';

const collector: OfflineCollector = {
  slide: vi.fn(async () => ({ image: 'data:image/png;base64,AA==', ratio: 0.5625, media: [] })),
  narration: vi.fn(async () => 'data:audio/wav;base64,AA=='),
};
function scene(type: string, order: number): Scene {
  return {
    id: type,
    stageId: 'test',
    title: type,
    order,
    type,
    content:
      type === 'slide'
        ? { type, canvas: { elements: [] } }
        : type === 'quiz'
          ? {
              type,
              questions: [
                {
                  id: 'q',
                  type: 'single',
                  question: 'Choose',
                  options: [{ label: 'A', value: 'A' }],
                  answer: ['A'],
                },
              ],
            }
          : { type, html: '<p>Interactive</p>' },
    actions: [{ id: 'speech', type: 'speech', text: 'Narration', audioId: 'audio' }],
  } as Scene;
}

describe('offline player export', () => {
  it('keeps slide, quiz, interaction and narration in teaching order', async () => {
    const lesson = await buildOfflineLesson(
      [scene('quiz', 3), scene('slide', 1), scene('interactive', 2)],
      '课件',
      new Map([['interactive', '<p>Interactive</p>']]),
      collector,
    );
    expect(lesson.pages.map((p) => p.kind)).toEqual(['slide', 'interactive', 'quiz']);
    expect(lesson.pages.every((p) => p.narration[0].src?.startsWith('data:audio'))).toBe(true);
    expect(lesson.pages[1].html).toContain('offlineLesson');
    expect(lesson.pages[2].questions).toHaveLength(1);
  });
  it('refuses missing or still externally dependent interaction', async () => {
    await expect(
      buildOfflineLesson([scene('interactive', 0)], '', new Map(), collector),
    ).rejects.toThrow('互动内容为空');
    await expect(
      buildOfflineLesson(
        [scene('interactive', 0)],
        '',
        new Map([['interactive', '<img src="/lost.png">']]),
        collector,
      ),
    ).rejects.toThrow('未打包资源');
  });
  it('names missing scene media and refuses unsupported online scenes', async () => {
    await expect(
      buildOfflineLesson([scene('slide', 0)], '', new Map(), {
        ...collector,
        slide: async () => {
          throw new Error('missing image');
        },
      }),
    ).rejects.toThrow('「slide」');
    await expect(buildOfflineLesson([scene('pbl', 0)], '', new Map(), collector)).rejects.toThrow(
      '在线 AI',
    );
  });
  it('does not let authored text break out of the JSON script', () => {
    const html = buildOfflinePlayerHtml({ title: '</script><script>alert(1)</script>', pages: [] });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
  });
  it('renders quiz formulas as self-contained MathML with untrusted prose escaped', () => {
    const html = buildOfflinePlayerHtml({
      title: '数学',
      pages: [
        {
          id: 'q',
          title: '练习',
          kind: 'quiz',
          narration: [],
          questions: [
            { id: 'q1', type: 'short_answer', question: '求 $x^2$ <img src=x onerror=alert(1)>' },
          ],
        },
      ],
    });
    expect(html).toContain('MathML');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });
  it('ships a quiz-only player and starts HTML before the backup PPTX', async () => {
    const scenes = [scene('quiz', 0)];
    const getPptxBlob = vi.fn();
    const result = await buildResourcePackZip(scenes, [], [], {
      fileName: 'quiz',
      viewportSize: 960,
      viewportRatio: 0.5625,
      ratioPx2Inch: 96,
      ratioPx2Pt: 72,
      getPptxBlob,
      getOfflinePlayer: async (map) =>
        buildOfflinePlayerHtml(await buildOfflineLesson(scenes, 'quiz', map, collector)),
    });
    const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer());
    expect(await zip.file('开始授课.html')!.async('string')).toBe(
      await zip.file('START.html')!.async('string'),
    );
    const launcher = await zip.file('开始授课.cmd')!.async('string');
    expect(launcher.indexOf('START.html')).toBeLessThan(launcher.indexOf('*.pptx'));
    expect(getPptxBlob).not.toHaveBeenCalled();
    expect(result.skippedPptx).toBe(true);
  });
});
