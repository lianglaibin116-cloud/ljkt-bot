import { describe, expect, it } from 'vitest';
import { withoutStudentChecklists } from '@/lib/course-documents/student-notes';
import { draft } from './fixtures';

describe('student note content', () => {
  it('removes a nested learning checklist from saved notes while retaining knowledge and sources', () => {
    const saved = draft({
      kind: 'student-notes',
      sections: [
        {
          id: 'summary',
          title: '核心知识总结与复习清单',
          content: [
            '## 核心方程式',
            '$a^2+b^2=c^2$',
            '## 修订检查清单',
            '- [ ] 能写出方程式。',
            '### 掌握情况',
            '- [ ] 已掌握。',
            '## 常见错误',
            '不能混淆直角边与斜边。',
          ].join('\n'),
          sourceSceneIds: ['page4'],
        },
        { id: 'review', title: '复习清单', content: '- [ ] 能独立解题', sourceSceneIds: [] },
      ],
    });
    const result = withoutStudentChecklists(saved);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe('核心知识总结');
    expect(result.sections[0].content).toBe(
      '## 核心方程式\n$a^2+b^2=c^2$\n## 常见错误\n不能混淆直角边与斜边。',
    );
    expect(result.sections[0].sourceSceneIds).toEqual(['page4']);
    expect(saved.sections[0].content).toContain('修订检查清单');
  });

  it('preserves teaching procedures, safety checklists, quizzes and fenced code', () => {
    const saved = draft({
      kind: 'student-notes',
      sections: [
        {
          id: 'safety',
          title: '实验安全检查清单',
          content:
            '## 加热前安全检查\n- 检查装置气密性。\n## PBL成功标准\n- 连接顺序正确。\n```md\n## 修订检查清单\n示例标题\n```\n## Review checklist\n- [ ] Can explain it.\n## 答案与解析\n先移导管，后熄灯。',
          sourceSceneIds: ['page1'],
        },
        {
          id: 'quiz-page1-0',
          title: '随堂测验',
          content: '## 学习自查清单\n题目要求分析这份清单。\n\n答案：略。',
          sourceSceneIds: ['page1'],
        },
      ],
    });
    const result = withoutStudentChecklists(saved);
    expect(result.sections[0].title).toBe('实验安全检查清单');
    expect(result.sections[0].content).toContain('检查装置气密性');
    expect(result.sections[0].content).toContain('## PBL成功标准');
    expect(result.sections[0].content).toContain('```md\n## 修订检查清单\n示例标题\n```');
    expect(result.sections[0].content).not.toContain('Can explain it');
    expect(result.sections[0].content).toContain('## 答案与解析\n先移导管，后熄灯。');
    expect(result.sections[1]).toEqual(saved.sections[1]);
    expect(withoutStudentChecklists({ ...saved, kind: 'teacher-plan' })).toEqual({
      ...saved,
      kind: 'teacher-plan',
    });
  });
});
