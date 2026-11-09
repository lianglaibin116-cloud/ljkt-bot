import { slideToPng } from '@openmaic/renderer/snapshot';
import { resolveAudioBlob } from '@/lib/media/resolve-audio-bytes';
import { resolveStoredBytes } from '@/lib/media/resolve-stored-bytes';
import { isConcreteMediaAddress } from '@/lib/media/resolve-media-ref';
import { resolveVideoMediaForElement } from '@/lib/media/media-task-resolution';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { slideMediaReferenceSlots } from '@/lib/media/slide-media-slots';
import { db } from '@/lib/utils/database';
import { toDataUri, type FetchAsset } from '../inline-assets';
import type { OfflineCollector } from './build';
import type { OfflineMedia } from './types';

export function createOfflineCollector(
  fetcher: FetchAsset,
  viewportSize: number,
  viewportRatio: number,
): OfflineCollector {
  const cache = new Map<string, Promise<string>>();
  async function data(blob: Blob): Promise<string> {
    return toDataUri(
      new Uint8Array(await blob.arrayBuffer()),
      blob.type || 'application/octet-stream',
    );
  }
  function asset(ref: string, stageId: string): Promise<string> {
    const key = stageId + ':' + ref;
    if (!cache.has(key))
      cache.set(
        key,
        (async () => {
          if (/^data:/i.test(ref)) return ref;
          if (isConcreteMediaAddress(ref) || ref.startsWith('/')) {
            const result = await fetcher(ref);
            if (result?.bytes.length) return toDataUri(result.bytes, result.contentType);
          } else {
            const blob = await resolveStoredBytes(ref, {
              stageId,
              loadCompatRow: true,
              compatRowCdnFallback: true,
              taskUrlFallback: true,
              resolutionGating: true,
              fetchPolicy: { requireOk: true, requireNonEmpty: true },
            });
            if (blob?.size) return data(blob);
          }
          throw new Error('素材缺失或无法读取（' + ref.slice(0, 100) + '）');
        })(),
      );
    return cache.get(key)!;
  }
  return {
    async slide(source, stageId) {
      const slide = structuredClone(source);
      slide.viewportSize ??= viewportSize;
      slide.viewportRatio ??= viewportRatio;
      const width = slide.viewportSize,
        height = width * slide.viewportRatio;
      const media: OfflineMedia[] = [];
      for (const element of slide.elements) {
        if (element.type !== 'video' && element.type !== 'audio') continue;
        const ref =
          element.type === 'video'
            ? resolveVideoMediaForElement(
                useMediaGenerationStore.getState().tasks,
                element,
                stageId,
              ).sourceRef
            : element.src;
        if (!ref) throw new Error('音视频没有可用素材');
        media.push({
          kind: element.type,
          src: await asset(ref, stageId),
          left: (element.left / width) * 100,
          top: (element.top / height) * 100,
          width: (element.width / width) * 100,
          height: (element.height / height) * 100,
          rotate: element.rotate || 0,
        });
      }
      // The static canvas preserves the original layout; media remain playable overlays.
      slide.elements = slide.elements.filter((e) => e.type !== 'audio' && e.type !== 'video');
      for (const slot of slideMediaReferenceSlots(slide)) {
        const ref = slot.read();
        if (!ref) throw new Error('图片内容为空，请补齐素材');
        const embedded = await asset(ref, stageId);
        if (typeof Image !== 'undefined') {
          const image = new Image();
          image.src = embedded;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              image.decode(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('图片解码超时')), 10000);
              }),
            ]);
          } catch {
            throw new Error('图片无法解码（' + ref.slice(0, 100) + '）');
          } finally {
            clearTimeout(timer);
          }
        }
        slot.write(embedded);
      }
      const image = await slideToPng(slide, { width: 1920, pixelRatio: 1, format: 'dataUrl' });
      return { image: image as string, ratio: slide.viewportRatio, media };
    },
    async narration(action, scene) {
      if (action.audioInvalidated) return undefined;
      const legacyUrl = (action as typeof action & { audioUrl?: string }).audioUrl;
      if (action.audioId) {
        const blob = await resolveAudioBlob(action.audioId);
        if (blob?.size) return data(blob);
        const row = await db.audioFiles.get(action.audioId);
        if (row?.ossKey) return asset(row.ossKey, scene.stageId);
        return asset(legacyUrl || action.audioId, scene.stageId);
      }
      return legacyUrl ? asset(legacyUrl, scene.stageId) : undefined;
    },
  };
}
