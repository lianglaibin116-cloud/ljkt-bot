import { describe, expect, it } from 'vitest';
import {
  courseDocumentsReady,
  educationalHtmlText,
  extractCourseDocumentSource,
  fingerprintCourseSource,
} from '@/lib/course-documents/source';
import { scenes, source, stage } from './fixtures';

describe('course teaching source', () => {
  it('extracts formulas, tables, code, chart data and speech from the actual slides', () => {
    const page = source().pages[0];
    for (const value of [
      'a^2+b^2=c^2',
      '9+16=25',
      '直角边',
      'c = (a*a + b*b)',
      '先确认直角',
      '[9,16,25]',
    ])
      expect(page.text).toContain(value);
  });
  it('never executes or includes interactive scripts, styles or student runtime history', () => {
    const result = JSON.stringify(source());
    expect(result).toContain('观察面积');
    expect(result).toContain('确定梯长');
    expect(result).toContain('正确计算并说明单位');
    for (const value of [
      'never-execute',
      'throw new',
      'color:red',
      'private-learner',
      'private-submission',
      'private-chat',
    ])
      expect(result).not.toContain(value);
  });
  it('keeps exact quiz answers and explanations', () => {
    const question = source().pages[2].questions[0];
    expect(question.answer).toEqual(['A']);
    expect(question.analysis).toBe('由9＋16＝25，斜边为5。');
  });
  it('preserves Markdown code and angle brackets in quiz and narration text', () => {
    const changed = structuredClone(scenes);
    if (changed[2].content.type === 'quiz')
      changed[2].content.questions[0].question = '解释 `vector<T>` 与 `#include <vector>`。';
    changed[0].actions = [
      { id: 'speech', type: 'speech', text: '代码使用 vector<T>，条件 x < 3。' },
    ];
    const extracted = extractCourseDocumentSource(stage, changed);
    expect(extracted.pages[2].questions[0].question).toContain('vector<T>');
    expect(extracted.pages[0].text).toContain('vector<T>');
  });
  it('includes whiteboard derivations and code without hashing their appearance', async () => {
    const changed = structuredClone(scenes);
    changed[0].actions = [
      { id: 'wb1', type: 'wb_draw_latex', latex: 'c=\\sqrt{9+16}=5', x: 0, y: 0, color: 'red' },
      { id: 'wb2', type: 'wb_draw_code', language: 'python', code: 'print(3**2+4**2)', x: 0, y: 0 },
    ];
    const original = extractCourseDocumentSource(stage, changed);
    expect(original.pages[0].text).toContain('c=\\sqrt{9+16}=5');
    expect(original.pages[0].text).toContain('print(3**2+4**2)');
    if (changed[0].actions[0].type === 'wb_draw_latex') {
      changed[0].actions[0].color = 'blue';
      changed[0].actions[0].x = 500;
    }
    expect(await fingerprintCourseSource(extractCourseDocumentSource(stage, changed))).toBe(
      await fingerprintCourseSource(original),
    );
  });
  it('does not hash typography, coordinates, playback data or timestamps', async () => {
    const changed = structuredClone(scenes);
    const element = (
      changed[0].content as unknown as { canvas: { elements: Record<string, unknown>[] } }
    ).canvas.elements[0];
    element.left = 500;
    element.defaultColor = 'blue';
    const altered = extractCourseDocumentSource({ ...stage, updatedAt: 999 }, changed);
    expect(await fingerprintCourseSource(altered)).toBe(await fingerprintCourseSource(source()));
  });
  it('detects semantic edits, deleted pages, page order and quiz answer changes', async () => {
    const original = await fingerprintCourseSource(source());
    const variants = [source(), source(), source(), source()];
    variants[0].pages[0].text += '新知识';
    variants[1].pages.pop();
    variants[2].pages.reverse();
    variants[3].pages[2].questions[0].answer = ['B'];
    for (const variant of variants)
      expect(await fingerprintCourseSource(variant)).not.toBe(original);
  });
  it('warns about image-only content and remote-only interactive scenes', () => {
    const changed = structuredClone(scenes).slice(0, 2);
    (changed[0].content as unknown as { canvas: { elements: unknown[] } }).canvas.elements = [];
    changed[0].actions = [];
    changed[1].content = { type: 'interactive', url: 'https://example.com' };
    expect(extractCourseDocumentSource(stage, changed).warnings).toHaveLength(3);
  });
  it('decodes entities and lifts rendered formula annotations only once', () => {
    expect(
      educationalHtmlText(
        '<p>&lt;3 &amp; 4<span class="katex"><annotation encoding="application/x-tex">x^2</annotation><span>x2</span></span></p>',
      ),
    ).toBe('<3 & 4 $x^2$');
  });
  it('allows imported completed content without outlines and refuses unfinished generation', () => {
    const ready = {
      scenes: [{}],
      generatingOutlines: [],
      failedOutlines: [],
      generationStatus: 'idle',
    };
    expect(courseDocumentsReady(ready)).toBe(true);
    for (const status of ['generating', 'paused', 'error'])
      expect(courseDocumentsReady({ ...ready, generationStatus: status })).toBe(false);
    expect(courseDocumentsReady({ ...ready, failedOutlines: [{}] })).toBe(false);
  });
});
