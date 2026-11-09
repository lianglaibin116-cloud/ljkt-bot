import type { SchoolCourseProfile, Stage } from '@openmaic/dsl';
import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import { requiredSchoolProfileFields } from '@/lib/generation/school-course-profile';

export type CourseAuditSeverity = 'blocking' | 'warning' | 'info';
export type CourseAuditCategory =
  | 'metadata'
  | 'teaching'
  | 'assessment'
  | 'timing'
  | 'safety'
  | 'language'
  | 'visual'
  | 'offline';

export interface CourseAuditIssue {
  id: string;
  severity: CourseAuditSeverity;
  category: CourseAuditCategory;
  title: string;
  detail: string;
  sceneId?: string;
  sceneTitle?: string;
}

export interface CourseAuditStats {
  sceneCount: number;
  slideCount: number;
  interactiveCount: number;
  quizCount: number;
  narrationCharacters: number;
  estimatedMinutes: number;
}

export interface CourseAuditReport {
  score: number;
  status: 'not-enabled' | 'blocked' | 'review-needed' | 'approved';
  blockingCount: number;
  warningCount: number;
  issues: CourseAuditIssue[];
  stats: CourseAuditStats;
}

function speechText(actions: readonly Action[] | undefined): string {
  return (actions ?? [])
    .filter((action) => action.type === 'speech')
    .map((action) => action.text)
    .join('\n');
}

function sceneText(scene: Scene): string {
  const content = scene.content;
  const base = `${scene.title}\n${speechText(scene.actions)}`;
  if (content.type === 'slide') {
    return `${base}\n${JSON.stringify(content.canvas.elements)}`;
  }
  if (content.type === 'quiz') {
    return `${base}\n${content.questions
      .map((question) =>
        [
          question.question,
          question.analysis,
          ...(question.options ?? []).map((option) => option.label),
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n')}`;
  }
  if (content.type === 'interactive') {
    return `${base}\n${content.html ?? ''}\n${JSON.stringify(content.widgetConfig ?? {})}`;
  }
  return base;
}

function issue(
  severity: CourseAuditSeverity,
  category: CourseAuditCategory,
  id: string,
  title: string,
  detail: string,
  scene?: Scene,
): CourseAuditIssue {
  return {
    id,
    severity,
    category,
    title,
    detail,
    ...(scene ? { sceneId: scene.id, sceneTitle: scene.title } : {}),
  };
}

function auditProfile(profile: SchoolCourseProfile, issues: CourseAuditIssue[]): void {
  const missing = requiredSchoolProfileFields(profile);
  if (missing.length > 0) {
    issues.push(
      issue(
        'blocking',
        'metadata',
        'profile-required-fields',
        '学校课件信息不完整',
        `缺少：${missing.join('、')}。请返回学校课件设置补充。`,
      ),
    );
  }
  if (!profile.textbookVersion.trim() || !profile.unit.trim()) {
    issues.push(
      issue(
        'warning',
        'metadata',
        'profile-textbook',
        '教材依据不完整',
        '建议填写教材版本、册次和单元，便于学校教研审核。',
      ),
    );
  }
  if (!profile.sourceReferences.trim()) {
    issues.push(
      issue(
        'warning',
        'metadata',
        'profile-sources',
        '没有填写课程标准或资料来源',
        'AI生成内容需要教师依据课程标准、审定教材或权威资料逐项核验。',
      ),
    );
  }
}

const SAFETY_PATTERNS: Array<{
  pattern: RegExp;
  severity: CourseAuditSeverity;
  title: string;
  detail: string;
}> = [
  {
    pattern: /直接闻|凑近闻|用嘴吸|口尝|徒手触摸/,
    severity: 'blocking',
    title: '可能包含危险实验操作',
    detail: '请依据实验室安全规范改写，不得引导学生直接闻、尝、吸取或徒手接触。',
  },
  {
    pattern: /氯气泄漏|有毒气体泄漏|强酸泄漏|强碱泄漏|触电急救|心肺复苏/,
    severity: 'warning',
    title: '包含应急或高风险内容',
    detail: '必须引用权威应急口径并由专业教师审核，避免把演示建议当成现场处置指令。',
  },
];

const ABSOLUTE_LANGUAGE = /几乎每年都会|一定会考|绝对不会|百分之百|永远正确|送分题/;
const NEGATED_DANGEROUS_OPERATION =
  /(?:不可|不可以|不要|不应|不能|禁止|避免|不得|严禁)[^。！？\n]{0,8}(?:直接闻|凑近闻|用嘴吸|口尝|徒手触摸)/g;

function auditSceneLanguage(scenes: readonly Scene[], issues: CourseAuditIssue[]): void {
  for (const scene of scenes) {
    const text = sceneText(scene);
    const safetyText = text.replace(NEGATED_DANGEROUS_OPERATION, '');
    for (const safety of SAFETY_PATTERNS) {
      if (safety.pattern.test(safetyText)) {
        issues.push(
          issue(
            safety.severity,
            'safety',
            `safety-${scene.id}-${safety.title}`,
            safety.title,
            safety.detail,
            scene,
          ),
        );
      }
    }
    if (ABSOLUTE_LANGUAGE.test(text)) {
      issues.push(
        issue(
          'warning',
          'language',
          `absolute-language-${scene.id}`,
          '存在绝对化或过度应试表述',
          '建议改为可验证、客观的教学语言，并删除没有来源的考试频率判断。',
          scene,
        ),
      );
    }
    if (scene.content.type === 'interactive' && scene.content.widgetType === 'code') {
      const subjectHint = text.toLowerCase();
      if (!/(编程|程序|代码|python|javascript|typescript|java|c\+\+)/i.test(subjectHint)) {
        issues.push(
          issue(
            'warning',
            'teaching',
            `tool-fit-${scene.id}`,
            '代码互动可能与教学任务不匹配',
            '非编程任务不应自动使用代码编辑器；建议改为分步计算、白板或测验场景。',
            scene,
          ),
        );
      }
    }
  }
}

function statsFor(scenes: readonly Scene[]): CourseAuditStats {
  const narrationCharacters = scenes.reduce(
    (sum, scene) => sum + speechText(scene.actions).replace(/\s/g, '').length,
    0,
  );
  const slideCount = scenes.filter((scene) => scene.type === 'slide').length;
  const interactiveCount = scenes.filter((scene) => scene.type === 'interactive').length;
  const quizCount = scenes.filter((scene) => scene.type === 'quiz').length;
  // Chinese classroom narration averages roughly 240-280 characters/minute.
  // Interactions and quizzes reserve handling time beyond the spoken script.
  const estimatedMinutes = Math.ceil(
    narrationCharacters / 260 + interactiveCount * 1.5 + quizCount * 1.5,
  );
  return {
    sceneCount: scenes.length,
    slideCount,
    interactiveCount,
    quizCount,
    narrationCharacters,
    estimatedMinutes,
  };
}

export function auditSchoolCourse(
  stage: Stage | null,
  scenes: readonly Scene[],
  outlines: readonly SceneOutline[] = [],
): CourseAuditReport {
  const stats = statsFor(scenes);
  const profile = stage?.schoolCourseProfile;
  if (!profile?.enabled) {
    return {
      score: 0,
      status: 'not-enabled',
      blockingCount: 0,
      warningCount: 0,
      issues: [],
      stats,
    };
  }

  const issues: CourseAuditIssue[] = [];
  auditProfile(profile, issues);

  if (scenes.length === 0) {
    issues.push(
      issue('blocking', 'teaching', 'no-scenes', '课件没有可授课页面', '请先完成课程生成。'),
    );
  }
  if (stats.interactiveCount > profile.interactionBudget) {
    issues.push(
      issue(
        'warning',
        'timing',
        'interaction-budget',
        '互动场景超过教师设置的上限',
        `当前${stats.interactiveCount}个，设置上限${profile.interactionBudget}个。建议保留最能支撑学习目标的互动。`,
      ),
    );
  }
  if (stats.estimatedMinutes > Math.ceil(profile.durationMinutes * 1.15)) {
    issues.push(
      issue(
        'blocking',
        'timing',
        'duration-overrun',
        '预计授课时间超过课时',
        `预计约${stats.estimatedMinutes}分钟，计划${profile.durationMinutes}分钟。请精简讲解或互动。`,
      ),
    );
  }
  if (profile.assessmentMode === 'quiz' && stats.quizCount === 0) {
    issues.push(
      issue(
        'blocking',
        'assessment',
        'missing-quiz',
        '设置了课内测验但没有测验页面',
        '请增加与学习目标对应的测验场景，或调整评价方式。',
      ),
    );
  }
  if (
    profile.assessmentMode === 'formative' &&
    stats.quizCount === 0 &&
    stats.interactiveCount === 0
  ) {
    issues.push(
      issue(
        'warning',
        'assessment',
        'missing-formative-check',
        '缺少可观察的形成性评价活动',
        '建议增加课堂检查、问题或短测，并明确评价标准。',
      ),
    );
  }
  if (outlines.length > 0 && outlines.some((outline) => !outline.teachingObjective?.trim())) {
    issues.push(
      issue(
        'warning',
        'teaching',
        'outline-objectives',
        '部分页面没有对应学习目标',
        '建议在大纲中补充每页教学目标，确保内容、活动和评价一致。',
      ),
    );
  }

  auditSceneLanguage(scenes, issues);

  if (!profile.teacherReviewed) {
    issues.push(
      issue(
        'blocking',
        'teaching',
        'teacher-review',
        '尚未完成教师审核确认',
        '请处理阻断问题后，由任课教师确认知识、语言、实验安全和课堂节奏。',
      ),
    );
  }

  const blockingCount = issues.filter((item) => item.severity === 'blocking').length;
  const warningCount = issues.filter((item) => item.severity === 'warning').length;
  const score = Math.max(0, 100 - blockingCount * 20 - warningCount * 6);
  return {
    score,
    status: blockingCount > 0 ? 'blocked' : warningCount > 0 ? 'review-needed' : 'approved',
    blockingCount,
    warningCount,
    issues,
    stats,
  };
}

/** Teacher confirmation is allowed once every blocker except the confirmation itself is cleared. */
export function canConfirmTeacherReview(report: CourseAuditReport): boolean {
  return report.issues.every(
    (item) => item.severity !== 'blocking' || item.id === 'teacher-review',
  );
}
