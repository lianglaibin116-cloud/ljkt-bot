import type { Slide, SpeechAction } from '@ljkt/dsl';
import type { Scene } from '@/lib/types/stage';
import { collectAssetRefs } from '../inline-assets';
import { prepareOfflineInteraction } from './bridge';
import type { OfflineLesson, OfflinePage } from './types';

export class OfflinePlayerError extends Error {}

export interface OfflineCollector {
  slide(slide: Slide, stageId: string): Promise<Pick<OfflinePage, 'image' | 'media' | 'ratio'>>;
  narration(action: SpeechAction, scene: Scene): Promise<string | undefined>;
}

/** The player must never silently omit a scene or a referenced local asset. */
export async function buildOfflineLesson(
  scenes: Scene[],
  title: string,
  interactiveHtml: Map<string, string>,
  collector: OfflineCollector,
): Promise<OfflineLesson> {
  const pages: OfflinePage[] = [];
  for (const scene of [...scenes].sort((a, b) => a.order - b.order)) {
    try {
      const content = scene.content;
      const page: OfflinePage = {
        id: scene.id,
        title: scene.title,
        kind: 'slide',
        narration: [],
      };
      if (content.type === 'slide') {
        Object.assign(page, await collector.slide(content.canvas, scene.stageId));
      } else if (content.type === 'interactive') {
        const html = interactiveHtml.get(scene.id);
        if (!html) throw new Error('互动内容为空，请先完成生成');
        const remaining = collectAssetRefs(html, { includeRelative: true });
        if (remaining.length)
          throw new Error(
            '互动仍依赖未打包资源：' + remaining.map((r) => r.url.slice(0, 120)).join('、'),
          );
        page.kind = 'interactive';
        page.html = prepareOfflineInteraction(html);
      } else if (content.type === 'quiz') {
        if (!content.questions.length) throw new Error('测验没有题目');
        page.kind = 'quiz';
        page.questions = structuredClone(content.questions);
      } else {
        throw new Error('该场景需要在线 AI 服务，暂不支持 U 盘播放器；请先替换为离线教学内容');
      }
      for (const action of scene.actions ?? []) {
        if (action.type !== 'speech') continue;
        page.narration.push({ text: action.text, src: await collector.narration(action, scene) });
      }
      for (const board of scene.whiteboards ?? []) {
        const rendered = await collector.slide(board, scene.stageId);
        if (rendered.media?.length) throw new Error('板书含音视频，请将其移至普通课件页后导出');
        (page.boards ??= []).push({ image: rendered.image!, ratio: rendered.ratio! });
      }
      pages.push(page);
    } catch (error) {
      throw new OfflinePlayerError(
        `「${scene.title}」无法离线导出：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { title, pages };
}
