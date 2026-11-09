import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHOOL_COURSE_PROFILE,
  normalizeSchoolCourseProfile,
  requiredSchoolProfileFields,
  withSchoolCourseProfile,
} from '@/lib/generation/school-course-profile';

describe('school course profile', () => {
  it('keeps legacy prompts unchanged when the profile is disabled', () => {
    expect(withSchoolCourseProfile('生成一节化学课', DEFAULT_SCHOOL_COURSE_PROFILE)).toBe(
      '生成一节化学课',
    );
  });

  it('adds school teaching constraints to the generation requirement', () => {
    const profile = normalizeSchoolCourseProfile({
      ...DEFAULT_SCHOOL_COURSE_PROFILE,
      enabled: true,
      educationStage: 'senior',
      grade: '高一',
      subject: '化学',
      learningObjectives: '理解氧化还原反应',
      keyPoints: '电子转移',
      difficultPoints: '配平方法',
      durationMinutes: 45,
      interactionBudget: 2,
    });
    const prompt = withSchoolCourseProfile('生成一节化学课', profile);

    expect(prompt).toContain('高一');
    expect(prompt).toContain('学习目标：理解氧化还原反应');
    expect(prompt).toContain('互动预算：最多2个');
    expect(prompt).toContain('必须由任课教师复核');
  });

  it('reports required fields and clamps numeric inputs', () => {
    const profile = normalizeSchoolCourseProfile({
      ...DEFAULT_SCHOOL_COURSE_PROFILE,
      enabled: true,
      durationMinutes: 300,
      interactionBudget: -5,
    });

    expect(profile.durationMinutes).toBe(180);
    expect(profile.interactionBudget).toBe(0);
    expect(requiredSchoolProfileFields(profile)).toEqual([
      '年级',
      '学科',
      '学习目标',
      '教学重点',
      '教学难点',
    ]);
  });
});
