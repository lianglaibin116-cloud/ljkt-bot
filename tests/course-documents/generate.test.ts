import { describe, expect, it, vi } from 'vitest';
import { chunkCourseSource, generateCourseDocument } from '@/lib/course-documents/generate';
import { source } from './fixtures';

function response(ids: string[]) {
  return JSON.stringify({
    title: '勾股定理笔记',
    sections: [
      {
        id: 'knowledge',
        title: '知识与方法',
        content: '直角三角形中 $a^2+b^2=c^2$。',
        sourceSceneIds: ids,
      },
    ],
    warnings: [],
    referenceAnswers: [
      { key: 'page3/q1', answer: 'B', explanation: '模型试图改写已有答案' },
      { key: 'page3/q2', answer: '该等式以直角为前提。', explanation: '非直角三角形需考虑夹角。' },
    ],
  });
}

describe('document generation', () => {
  it('omits model-added revision checklists while retaining the knowledge summary and quizzes', async () => {
    const result = await generateCourseDocument({
      source: source(),
      kind: 'student-notes',
      call: async () => {
        const output = JSON.parse(response(source().pages.map((page) => page.id)));
        output.sections[0].content += '\n\n## 修订检查清单\n- [ ] 能解释勾股定理。';
        return JSON.stringify(output);
      },
    });
    expect(result.sections[0].content).toBe('直角三角形中 $a^2+b^2=c^2$。');
    expect(result.sections.filter((section) => section.id.startsWith('quiz-'))).toHaveLength(2);
  });
  it('appends EVERY quiz with the original key and analysis, and labels inferred answers', async () => {
    const result = await generateCourseDocument({
      source: source(),
      kind: 'student-notes',
      call: async () => response(source().pages.map((p) => p.id)),
    });
    const questions = result.sections.filter((s) => s.id.startsWith('quiz-'));
    expect(questions).toHaveLength(2);
    expect(questions[0].content).toContain('**答案：** A. 5');
    expect(questions[0].content).toContain('由9＋16＝25，斜边为5。');
    expect(questions[0].content).not.toContain('模型试图');
    expect(questions[1].content).toContain('参考答案');
    expect(questions[1].content).toContain('以直角为前提');
  });
  it('keeps the last page and all long-page content across chunks', () => {
    const input = source();
    input.pages[0].text = '前'.repeat(10_000) + '最后一句';
    const chunks = chunkCourseSource(input, 2500);
    expect(chunks.length).toBeGreaterThan(3);
    expect(
      chunks
        .flat()
        .filter((p) => p.id === 'page1')
        .map((p) => p.text)
        .join(''),
    ).toContain('最后一句');
    expect(chunks.at(-1)!.at(-1)!.id).toBe('page4');
    expect(chunks.flat().flatMap((p) => p.questions)).toHaveLength(2);
  });
  it('processes all chunks for student notes and preserves tail-page citations', async () => {
    const input = source();
    input.pages[0].text = '定义'.repeat(6000);
    const visited = new Set<string>();
    const result = await generateCourseDocument({
      source: input,
      kind: 'student-notes',
      chunkLimit: 5000,
      call: async (_s, p) => {
        const pages = JSON.parse(p).pages as { id: string }[];
        pages.forEach((p) => visited.add(p.id));
        return response(pages.map((p) => p.id));
      },
    });
    expect(visited).toEqual(new Set(input.pages.map((p) => p.id)));
    expect(result.sections.some((s) => s.sourceSceneIds.includes('page4'))).toBe(true);
  });
  it('synthesizes long teacher plans without dropping any partial plan', async () => {
    const input = source();
    input.pages[0].text = '定义'.repeat(6000);
    let merged = false;
    const result = await generateCourseDocument({
      source: input,
      kind: 'teacher-plan',
      chunkLimit: 5000,
      call: async (_s, p) => {
        if (p.startsWith('Consolidate')) {
          merged = true;
          return response(input.pages.map((p) => p.id));
        }
        return response(JSON.parse(p).pages.map((page: { id: string }) => page.id));
      },
    });
    expect(merged).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].sourceSceneIds).toContain('page4');
  });
  it('retries malformed model JSON once, then refuses incomplete output', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce('```json\n{broken}\n```')
      .mockResolvedValue(response(source().pages.map((p) => p.id)));
    await generateCourseDocument({ source: source(), kind: 'teacher-plan', call });
    expect(call).toHaveBeenCalledTimes(2);
    await expect(
      generateCourseDocument({ source: source(), kind: 'teacher-plan', call: async () => '{}' }),
    ).rejects.toThrow();
  });
  it('keeps concrete source conflicts but omits general review caveats', async () => {
    const generic = '原页面未提供学生作答数据，因此不包含学习达成结论。';
    const conflict =
      '原页面同时出现“先熄灭酒精灯，再移导管”和“先移导管，后熄酒精灯”的表述，应采用后一种。';
    const scope = '第12页未提供更详细的启普发生器适用限制，教学时不宜据此外推。';
    const result = await generateCourseDocument({
      source: source(),
      kind: 'teacher-plan',
      call: async () =>
        JSON.stringify({
          ...JSON.parse(response(source().pages.map((page) => page.id))),
          warnings: [generic, conflict, scope],
        }),
    });
    expect(result.warnings).toEqual([conflict]);
  });
  it('rejects invented page ids and refuses an empty source before making paid calls', async () => {
    await expect(
      generateCourseDocument({
        source: source(),
        kind: 'teacher-plan',
        call: async () => response(['invented']),
      }),
    ).rejects.toThrow('不存在');
    const empty = source();
    empty.pages = empty.pages.map((p) => ({ ...p, text: '', questions: [] }));
    const call = vi.fn();
    await expect(
      generateCourseDocument({ source: empty, kind: 'teacher-plan', call }),
    ).rejects.toThrow('可读');
    expect(call).not.toHaveBeenCalled();
  });
});
