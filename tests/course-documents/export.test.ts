import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildCourseDocumentWord,
  courseDocumentPrintHtml,
  courseDocumentFileName,
} from '@/lib/course-documents/export';
import { prepareDocumentSave } from '@/lib/course-documents/types';
import { draft } from './fixtures';

export const sampleDocumentHtml = `<article><h1>勾股定理学生课堂笔记</h1><p>理解直角三角形的三边关系，并通过例题掌握求解方法。</p><section><h2>一 适用条件和定理</h2><p>勾股定理仅适用于直角三角形，a、b 是直角边，c 是斜边。</p><p><span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">a^2+b^2=c^2</annotation></semantics></math></span></span></p><h2>二 计算与对照</h2><table><thead><tr><th>直角边 a</th><th>直角边 b</th><th>斜边 c</th></tr></thead><tbody><tr><td>3</td><td>4</td><td>5</td></tr></tbody></table><ol><li>确认题目给出直角。</li><li>先平方再相加，最后开平方。</li></ol><pre><code>def hypotenuse(a, b): return (a*a + b*b) ** 0.5</code></pre><p class="course-document-sources">对应课件页：1. 定理与例题</p><h2>三 随堂测验与解析</h2><p>题目：两条直角边分别为3、4，求斜边。</p><p><strong>答案：</strong>5。</p><p>解析：3²＋4²＝9＋16＝25，斜边取正值，为5。</p></section></article>`;

describe('Word and print exports', () => {
  it('creates a genuine DOCX containing native Office math, Chinese, table rows and code', async () => {
    const blob = await buildCourseDocumentWord(sampleDocumentHtml);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('勾股定理学生课堂笔记');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('hypotenuse');
    expect(xml).toContain('<m:oMath');
    expect(xml).toContain('<m:sSup>');
    expect(xml).not.toContain('undefined');
    expect(xml).toContain('w:w="11906"');
    if (process.env.COURSE_DOC_QA_DIR) {
      const fs = await import('node:fs/promises');
      await fs.mkdir(process.env.COURSE_DOC_QA_DIR, { recursive: true });
      await fs.writeFile(
        `${process.env.COURSE_DOC_QA_DIR}/student-notes.docx`,
        Buffer.from(await blob.arrayBuffer()),
      );
    }
  });
  it('produces an isolated A4 print page and escapes the title', () => {
    const html = courseDocumentPrintHtml('</title><script>alert(1)</script>', sampleDocumentHtml);
    expect(html).toContain('@page{size:A4;margin:20mm}');
    expect(html).toContain('button,');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain(sampleDocumentHtml);
  });
  it('uses a safe document filename', () => {
    expect(
      courseDocumentFileName(
        prepareDocumentSave(null, draft({ title: '课程/计划:*?' }), 0, false),
        'docx',
      ),
    ).toBe('课程计划.docx');
  });
  it('preserves code line boundaries from the actual preview renderer', async () => {
    const html =
      '<div data-streamdown="code-block-body"><pre><code><span><span>def example():</span></span><span><span>    return 5</span></span></code></pre></div>';
    const blob = await buildCourseDocumentWord(html);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/def example\(\):[\s\S]*?<\/w:p>[\s\S]*?return 5/);
  });
});
