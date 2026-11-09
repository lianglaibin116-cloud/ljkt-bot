import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import {
  buildOfflineResourcePackDeck,
  buildPptxBlob,
  buildResourcePackZip,
  type OfflineResourcePackDeck,
} from '@/lib/export/use-export-pptx';
import type { Scene } from '@/lib/types/stage';

// Scenes with no external assets, so inlineHtmlAssets does no network fetches.
const interactiveHtml = '<!DOCTYPE html><html><body><h1>Spin the frame</h1></body></html>';

function interactiveScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    stageId: 'stg1',
    title: 'Interactive demo',
    order: 1,
    type: 'interactive',
    content: { type: 'interactive', url: '', html: interactiveHtml },
    ...overrides,
  } as unknown as Scene;
}

function slideScene(order = 1): Scene {
  return {
    id: `slide-scene-${order}`,
    stageId: 'stg1',
    title: `Slide ${order}`,
    order,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        id: `slide-${order}`,
        viewportSize: 960,
        viewportRatio: 0.5625,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#705cff'],
          fontColor: '#17213a',
          fontName: 'Microsoft YaHei',
        },
        elements: [],
      },
    },
  } as Scene;
}

async function readZipFiles(blob: Blob): Promise<Record<string, Uint8Array>> {
  // JSZip in Node can't consume a web Blob directly — convert to ArrayBuffer first.
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const entries: Record<string, Uint8Array> = {};
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  await Promise.all(
    files.map(async (name) => {
      entries[name] = await zip.files[name].async('uint8array');
    }),
  );
  return entries;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('buildResourcePackZip', () => {
  describe('interactive-only deck (no slides)', () => {
    it('creates a PPTX launch slide for the offline interaction', async () => {
      const getPptxBlob = vi.fn(async (_deck: OfflineResourcePackDeck) => new Blob(['pptx-bytes']));

      const result = await buildResourcePackZip([interactiveScene()], [], [], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'demo',
        getPptxBlob,
      });

      expect(result.empty).toBe(false);
      expect(result.skippedPptx).toBe(false);
      expect(getPptxBlob).toHaveBeenCalledTimes(1);
      const deck = getPptxBlob.mock.calls[0][0];
      expect(deck.slides).toHaveLength(1);
      expect(deck.slideScenes[0].id).toBe('s1');
      expect(deck.interactivePages[0].archivePath).toBe('interactive/scene-01.html');
    });

    it('ships the PPTX, HTML page, launcher, and Windows instructions together', async () => {
      const getPptxBlob = vi.fn(async () => new Blob(['pptx-bytes']));

      const result = await buildResourcePackZip([interactiveScene()], [], [], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'demo',
        getPptxBlob,
      });

      expect(result.blob).not.toBeNull();
      expect(result.skippedPptx).toBe(false);

      const files = await readZipFiles(result.blob!);
      const names = Object.keys(files);
      expect(names).toContain('interactive/scene-01.html');
      expect(decode(files['interactive/scene-01.html'])).toBe(interactiveHtml);
      expect(names).toContain('demo.pptx');
      expect(names).toContain('START.html');
      expect(names).toContain('使用说明.txt');
      expect(names).toContain('开始授课.cmd');
      expect(decode(files['START.html'])).toContain('Interactive demo');
      expect(decode(files['使用说明.txt'])).toContain('Alt + Tab');
      expect(decode(files['开始授课.cmd'])).toContain('for %%F in (*.pptx)');
    });

    it('includes the teacher guide and audit report for school courses', async () => {
      const result = await buildResourcePackZip([interactiveScene()], [], [], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'school-demo',
        getPptxBlob: async () => new Blob(['pptx-bytes']),
        schoolCourseProfile: {
          enabled: true,
          educationStage: 'senior',
          grade: '高一',
          subject: '化学',
          textbookVersion: '人教版',
          volume: '必修一',
          unit: '第二章',
          lessonType: 'new',
          durationMinutes: 45,
          learningObjectives: '理解氯气性质',
          keyPoints: '氧化还原反应',
          difficultPoints: '实验现象解释',
          learnerProfile: '已学习氧化还原基础',
          assessmentMode: 'teacher-check',
          interactionBudget: 2,
          sourceReferences: '课程标准与审定教材',
          teacherReviewed: true,
        },
        auditReport: {
          score: 94,
          status: 'review-needed',
          blockingCount: 0,
          warningCount: 1,
          issues: [],
          stats: {
            sceneCount: 1,
            slideCount: 0,
            interactiveCount: 1,
            quizCount: 0,
            narrationCharacters: 0,
            estimatedMinutes: 2,
          },
        },
      });

      const files = await readZipFiles(result.blob!);
      expect(decode(files['教师授课指南.txt'])).toContain('高一');
      expect(decode(files['教师授课指南.txt'])).toContain('理解氯气性质');
      expect(decode(files['课件审核报告.txt'])).toContain('审核结论：通过（有改进建议）');
    });
  });

  describe('deck with slides', () => {
    it('invokes the PPTX builder and includes the PPTX in the ZIP', async () => {
      // jszip reliably round-trips Uint8Array entries in Node; a Blob-backed
      // entry can confuse loadAsync when reading back.
      const pptxBytes = new Uint8Array([1, 2, 3, 4]);
      const getPptxBlob = vi.fn(async () => new Blob([pptxBytes]));

      const scene = slideScene();

      // The real slides' content isn't read — getPptxBlob is mocked, so the
      // builder only needs slides.length > 0 to decide PPTX is included.
      const placeholderSlide = { id: 'sl1' } as unknown as Parameters<
        typeof buildResourcePackZip
      >[1][number];

      const result = await buildResourcePackZip([scene], [placeholderSlide], [scene], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'deck',
        getPptxBlob,
      });

      expect(result.empty).toBe(false);
      expect(result.skippedPptx).toBe(false);
      expect(getPptxBlob).toHaveBeenCalledTimes(1);

      // The PPTX entry is present in the generated ZIP.
      const buf = await result.blob!.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      expect(Object.keys(zip.files)).toContain('deck.pptx');
    });
  });

  describe('empty deck (no slides, no interactive pages)', () => {
    it('returns empty and does not build anything', async () => {
      const getPptxBlob = vi.fn(async () => new Blob(['pptx-bytes']));

      const result = await buildResourcePackZip([], [], [], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'empty',
        getPptxBlob,
      });

      expect(result.empty).toBe(true);
      expect(result.blob).toBeNull();
      expect(getPptxBlob).not.toHaveBeenCalled();
    });
  });

  describe('interactive scene without html', () => {
    it('treats an interactive scene lacking an html payload as non-exportable', async () => {
      const getPptxBlob = vi.fn(async () => new Blob(['pptx-bytes']));
      const sceneNoHtml = interactiveScene({
        content: { type: 'interactive', url: 'https://example.com', html: '' },
      });

      const result = await buildResourcePackZip([sceneNoHtml], [], [], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'demo',
        getPptxBlob,
      });

      // No html + no slides ⇒ nothing to ship.
      expect(result.empty).toBe(true);
      expect(result.blob).toBeNull();
      expect(getPptxBlob).not.toHaveBeenCalled();
    });
  });

  describe('multiple interactive scenes', () => {
    it('uses ASCII numbered filenames and exposes every page from START.html', async () => {
      const getPptxBlob = vi.fn(async () => new Blob(['pptx-bytes']));
      const scenes = [
        interactiveScene({ id: 'a', title: 'First/Widget', order: 1 }),
        interactiveScene({ id: 'b', title: 'Second', order: 2 }),
        interactiveScene({ id: 'c', title: 'Third: Map', order: 3 }),
      ];

      const result = await buildResourcePackZip(scenes, [], [], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'demo',
        getPptxBlob,
      });

      expect(result.empty).toBe(false);
      const files = await readZipFiles(result.blob!);
      const names = Object.keys(files);
      expect(names).toContain('interactive/scene-01.html');
      expect(names).toContain('interactive/scene-02.html');
      expect(names).toContain('interactive/scene-03.html');
      // No name collision: all three pages survived.
      expect(names.filter((n) => n.startsWith('interactive/'))).toHaveLength(3);
      const start = decode(files['START.html']);
      expect(start).toContain('First/Widget');
      expect(start).toContain('interactive/scene-03.html');
    });
  });

  it('fails strict offline export when a remote asset cannot be embedded', async () => {
    const scene = interactiveScene({
      content: {
        type: 'interactive',
        url: '',
        html: '<!doctype html><html><body><img src="https://assets.invalid/demo.png"></body></html>',
      },
    });

    await expect(
      buildResourcePackZip([scene], [], [], {
        viewportRatio: 0.5625,
        viewportSize: 960,
        ratioPx2Inch: 96,
        ratioPx2Pt: 96 / 72,
        fileName: 'strict-demo',
        getPptxBlob: async () => new Blob(['pptx-bytes']),
        fetcher: async () => null,
        strictOffline: true,
      }),
    ).rejects.toThrow('external asset');
  });
});

describe('offline resource pack PPTX', () => {
  it('interleaves launch slides with normal slides and writes relative HTML links', async () => {
    const interactive = interactiveScene({ id: 'interactive-middle', order: 2 });
    const deck = buildOfflineResourcePackDeck(
      [slideScene(3), interactive, slideScene(1)],
      960,
      0.5625,
    );

    expect(deck.slideScenes.map((scene) => scene.id)).toEqual([
      'slide-scene-1',
      'interactive-middle',
      'slide-scene-3',
    ]);
    expect(
      deck.slides[1].elements.some(
        (element) => element.link?.target === 'interactive/scene-01.html',
      ),
    ).toBe(true);

    const pptx = await buildPptxBlob(deck.slides, deck.slideScenes, 0.5625, 960, 96, 96 / 72);
    const archive = await JSZip.loadAsync(await pptx.arrayBuffer());
    expect(
      Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)),
    ).toHaveLength(3);
    const relationshipFiles = Object.keys(archive.files).filter((name) =>
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name),
    );
    const relationships = (
      await Promise.all(relationshipFiles.map((name) => archive.file(name)!.async('string')))
    ).join('\n');
    expect(relationships).toContain('Target="interactive/scene-01.html"');
    expect(relationships).toContain('TargetMode="External"');
  });
});
