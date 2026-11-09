import type { Stage, Scene } from '@/lib/types/stage';
import type { CourseDocumentDraft } from '@/lib/course-documents/types';
import { extractCourseDocumentSource } from '@/lib/course-documents/source';

export const stage: Stage = {
  id: 'course-1',
  name: '勾股定理',
  createdAt: 1,
  updatedAt: 1,
  languageDirective: '使用中文。',
};
export const scenes = [
  {
    id: 'page1',
    stageId: stage.id,
    order: 1,
    title: '定理与例题',
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        elements: [
          {
            id: 'text',
            type: 'text',
            content:
              '<p>仅适用于直角三角形。<span data-inline-math="a^2+b^2=c^2">a2b2c2</span></p>',
            left: 10,
            top: 20,
            defaultColor: 'red',
          },
          { id: 'formula', type: 'latex', latex: '9+16=25' },
          {
            id: 'table',
            type: 'table',
            data: [
              [{ text: '直角边' }, { text: '斜边' }],
              [{ text: '3, 4' }, { text: '5' }],
            ],
          },
          {
            id: 'code',
            type: 'code',
            language: 'python',
            lines: [{ content: 'c = (a*a + b*b) ** 0.5' }],
          },
          {
            id: 'chart',
            type: 'chart',
            data: { labels: ['a²', 'b²', 'c²'], series: [[9, 16, 25]] },
          },
        ],
      },
    },
    actions: [{ id: 'speech', type: 'speech', text: '先确认直角，再求斜边。' }],
  },
  {
    id: 'page2',
    stageId: stage.id,
    order: 2,
    title: '面积互动',
    type: 'interactive',
    content: {
      type: 'interactive',
      html: '<main><h1>移动正方形</h1><p>观察面积：9＋16＝25。</p><script>window.secret="never-execute"; throw new Error("bad")</script><style>.x{color:red}</style></main>',
    },
  },
  {
    id: 'page3',
    stageId: stage.id,
    order: 3,
    title: '测验',
    type: 'quiz',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          question: '两直角边为3、4，斜边为多少？',
          options: [
            { value: 'A', label: '5' },
            { value: 'B', label: '7' },
          ],
          answer: ['A'],
          analysis: '由9＋16＝25，斜边为5。',
        },
        {
          id: 'q2',
          question: '说明为什么必须是直角三角形。',
          type: 'short_answer',
          commentPrompt: '指出定理适用条件。',
        },
      ],
    },
  },
  {
    id: 'page4',
    stageId: stage.id,
    order: 4,
    title: '测量任务',
    type: 'pbl',
    content: {
      type: 'pbl',
      projectV2: {
        title: '测量梯子',
        learningObjective: '利用勾股定理确定梯长',
        milestones: [
          {
            title: '完成测量',
            microtasks: [
              {
                title: '计算梯长',
                completionCriteria: '正确计算并说明单位。',
                engagement: { closingAnswer: 'private-learner-answer' },
              },
            ],
          },
        ],
        submissions: [{ content: 'private-submission' }],
        threads: [{ messages: [{ content: 'private-chat' }] }],
      },
    },
  },
] as unknown as Scene[];
export function source() {
  return extractCourseDocumentSource(stage, structuredClone(scenes));
}
export function draft(overrides: Partial<CourseDocumentDraft> = {}): CourseDocumentDraft {
  return {
    schemaVersion: 1,
    stageId: stage.id,
    kind: 'teacher-plan',
    title: '勾股定理 · 教师课程计划',
    sections: [
      {
        id: 'goals',
        title: '教学目标',
        content: '理解直角三角形的边长关系。',
        sourceSceneIds: ['page1'],
      },
    ],
    warnings: [],
    sourceFingerprint: 'a'.repeat(64),
    generatedAt: 1,
    ...overrides,
  };
}
