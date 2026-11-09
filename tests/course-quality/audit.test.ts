import { describe, expect, it } from 'vitest';
import type { Stage } from '@openmaic/dsl';
import { auditSchoolCourse, canConfirmTeacherReview } from '@/lib/course-quality/audit';
import type { Scene } from '@/lib/types/stage';

function stage(overrides: Partial<NonNullable<Stage['schoolCourseProfile']>> = {}): Stage {
  return {
    id: 'stage-1',
    name: '学校课件',
    createdAt: 1,
    updatedAt: 1,
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
      learnerProfile: '已有氧化还原基础',
      assessmentMode: 'teacher-check',
      interactionBudget: 2,
      sourceReferences: '课程标准与审定教材',
      teacherReviewed: false,
      ...overrides,
    },
  } as Stage;
}

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    stageId: 'stage-1',
    title: '氯气性质',
    order: 1,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        id: 'slide-1',
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
    actions: [{ id: 'speech-1', type: 'speech', text: '氯气是一种有毒气体。' }],
    ...overrides,
  } as Scene;
}

describe('school course audit', () => {
  it('keeps non-school courses outside the export gate', () => {
    const report = auditSchoolCourse({ ...stage(), schoolCourseProfile: undefined }, [scene()]);
    expect(report.status).toBe('not-enabled');
    expect(report.blockingCount).toBe(0);
  });

  it('requires teacher confirmation after automated checks pass', () => {
    const report = auditSchoolCourse(stage(), [scene()]);
    expect(report.issues.map((item) => item.id)).toContain('teacher-review');
    expect(canConfirmTeacherReview(report)).toBe(true);
  });

  it('blocks dangerous language and does not permit teacher sign-off yet', () => {
    const unsafe = scene({
      actions: [{ id: 'speech-unsafe', type: 'speech', text: '为了辨别气体，可以凑近闻。' }],
    });
    const report = auditSchoolCourse(stage(), [unsafe]);
    expect(report.issues.some((item) => item.category === 'safety')).toBe(true);
    expect(canConfirmTeacherReview(report)).toBe(false);
  });

  it('does not misclassify an explicit laboratory prohibition as an unsafe instruction', () => {
    const safeWarning = scene({
      actions: [{ id: 'speech-safe', type: 'speech', text: '实验中严禁凑近闻，应使用规范方法。' }],
    });
    const report = auditSchoolCourse(stage(), [safeWarning]);
    expect(report.issues.some((item) => item.category === 'safety')).toBe(false);
    expect(canConfirmTeacherReview(report)).toBe(true);
  });

  it('blocks a configured quiz assessment when no quiz page exists', () => {
    const report = auditSchoolCourse(stage({ assessmentMode: 'quiz' }), [scene()]);
    expect(report.issues.map((item) => item.id)).toContain('missing-quiz');
  });
});
