import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Slide, SpeechAction } from '@ljkt/dsl';
import type { Scene } from '@/lib/types/stage';
const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  audio: vi.fn(),
  stored: vi.fn(),
  row: vi.fn(),
}));
vi.mock('@ljkt/renderer/snapshot', () => ({ slideToPng: mocks.snapshot }));
vi.mock('@/lib/media/resolve-audio-bytes', () => ({ resolveAudioBlob: mocks.audio }));
vi.mock('@/lib/media/resolve-stored-bytes', () => ({ resolveStoredBytes: mocks.stored }));
vi.mock('@/lib/utils/database', () => ({ db: { audioFiles: { get: mocks.row } } }));
import { createOfflineCollector } from '@/lib/export/offline-player/collect';

describe('offline browser asset collection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot.mockResolvedValue('data:image/png;base64,AA==');
    mocks.audio.mockResolvedValue(null);
    mocks.row.mockResolvedValue(undefined);
    mocks.stored.mockResolvedValue(null);
  });
  it('embeds image bytes, keeps playable media geometry, and does not mutate the source', async () => {
    const fetcher = vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: 'image/png' }));
    const collector = createOfflineCollector(fetcher, 960, 0.5625);
    const source = {
      id: 's',
      elements: [
        {
          id: 'image',
          type: 'image',
          src: 'https://assets.test/image.png',
          left: 0,
          top: 0,
          width: 100,
          height: 100,
        },
        {
          id: 'video',
          type: 'video',
          src: 'https://assets.test/video.mp4',
          left: 96,
          top: 54,
          width: 480,
          height: 270,
          rotate: 0,
        },
      ],
    } as Slide;
    const result = await collector.slide(source, 'stage');
    expect(result.media?.[0]).toMatchObject({
      kind: 'video',
      left: 10,
      top: 10,
      width: 50,
      height: 50,
    });
    const rendered = mocks.snapshot.mock.calls[0][0];
    expect(rendered.elements).toHaveLength(1);
    expect(rendered.elements[0].src).toBe('data:image/png;base64,AQ==');
    expect(source.elements).toHaveLength(2);
    expect((source.elements[0] as { src: string }).src).toContain('https:');
  });
  it('does not snapshot a slide with missing generated images', async () => {
    const collector = createOfflineCollector(async () => null, 960, 0.5625);
    await expect(
      collector.slide(
        { elements: [{ id: 'i', type: 'image', src: 'allocated-image' }] } as Slide,
        'stage',
      ),
    ).rejects.toThrow('素材缺失');
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it('uses current pool narration before CDN and rejects missing referenced audio', async () => {
    const collector = createOfflineCollector(async () => null, 960, 0.5625);
    mocks.audio.mockResolvedValueOnce(new Blob(['audio'], { type: 'audio/wav' }));
    const action = { id: 'a', type: 'speech', text: '讲解', audioId: 'audio' } as SpeechAction;
    expect(await collector.narration(action, { stageId: 'stage' } as Scene)).toMatch(
      /^data:audio\/wav/,
    );
    expect(mocks.row).not.toHaveBeenCalled();
    await expect(collector.narration(action, { stageId: 'stage' } as Scene)).rejects.toThrow(
      '素材缺失',
    );
    expect(
      await collector.narration({ ...action, audioInvalidated: true }, {
        stageId: 'stage',
      } as Scene),
    ).toBeUndefined();
  });
});
