import { describe, expect, it } from 'vitest';
import {
  TEACHER_DEMO_REQUIREMENT,
  withTeacherDemoRequirement,
} from '@/lib/generation/teacher-demo-mode';

describe('withTeacherDemoRequirement', () => {
  it('keeps the original request unchanged when the preset is off', () => {
    expect(withTeacherDemoRequirement('  讲解光合作用  ', false)).toBe('  讲解光合作用  ');
  });

  it('adds a teacher-only presentation constraint when enabled', () => {
    const result = withTeacherDemoRequirement('  讲解光合作用  ', true);

    expect(result).toBe(`讲解光合作用\n\n${TEACHER_DEMO_REQUIREMENT}`);
    expect(result).toContain('只安排 AI 教师');
    expect(result).toContain('不要生成学生角色对话');
    expect(result).toContain('教师手动控制播放和翻页');
  });
});
