import type { SchoolCourseProfile } from '@openmaic/dsl';

export const SCHOOL_COURSE_PROFILE_STORAGE_KEY = 'schoolCourseProfile';

export const DEFAULT_SCHOOL_COURSE_PROFILE: SchoolCourseProfile = {
  enabled: false,
  educationStage: 'senior',
  grade: '',
  subject: '',
  textbookVersion: '',
  volume: '',
  unit: '',
  lessonType: 'new',
  durationMinutes: 40,
  learningObjectives: '',
  keyPoints: '',
  difficultPoints: '',
  learnerProfile: '',
  assessmentMode: 'teacher-check',
  interactionBudget: 1,
  sourceReferences: '',
  teacherReviewed: false,
};

const STAGE_LABELS: Record<SchoolCourseProfile['educationStage'], string> = {
  primary: '小学',
  junior: '初中',
  senior: '高中',
  vocational: '职业教育',
  higher: '高等教育',
  other: '其他',
};

const LESSON_TYPE_LABELS: Record<SchoolCourseProfile['lessonType'], string> = {
  new: '新授课',
  review: '复习课',
  experiment: '实验课',
  practice: '习题课',
  project: '项目课',
  other: '其他',
};

const ASSESSMENT_LABELS: Record<SchoolCourseProfile['assessmentMode'], string> = {
  none: '不安排测评，由教师现场判断',
  'teacher-check': '教师提问与课堂观察',
  formative: '形成性评价（课堂检查）',
  quiz: '课内测验',
};

export function normalizeSchoolCourseProfile(value: unknown): SchoolCourseProfile {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SCHOOL_COURSE_PROFILE };
  const input = value as Partial<SchoolCourseProfile>;
  const duration = Number(input.durationMinutes);
  const interactions = Number(input.interactionBudget);
  return {
    ...DEFAULT_SCHOOL_COURSE_PROFILE,
    ...input,
    enabled: input.enabled === true,
    durationMinutes: Number.isFinite(duration) ? Math.min(180, Math.max(10, duration)) : 40,
    interactionBudget: Number.isFinite(interactions)
      ? Math.min(6, Math.max(0, Math.round(interactions)))
      : 1,
    teacherReviewed: input.teacherReviewed === true,
  };
}

export function requiredSchoolProfileFields(profile: SchoolCourseProfile): string[] {
  if (!profile.enabled) return [];
  const missing: string[] = [];
  if (!profile.grade.trim()) missing.push('年级');
  if (!profile.subject.trim()) missing.push('学科');
  if (!profile.learningObjectives.trim()) missing.push('学习目标');
  if (!profile.keyPoints.trim()) missing.push('教学重点');
  if (!profile.difficultPoints.trim()) missing.push('教学难点');
  return missing;
}

/** Append the teacher-confirmed profile as explicit constraints for every outline mode. */
export function withSchoolCourseProfile(
  requirement: string,
  profile: SchoolCourseProfile | undefined,
): string {
  if (!profile?.enabled) return requirement;
  return `${requirement.trim()}\n\n学校标准课件要求（教师已在生成前配置）：\n- 学段：${STAGE_LABELS[profile.educationStage]}\n- 年级：${profile.grade}\n- 学科：${profile.subject}\n- 教材：${profile.textbookVersion || '未指定'} ${profile.volume || ''}\n- 单元/课题：${profile.unit || '未指定'}\n- 课型：${LESSON_TYPE_LABELS[profile.lessonType]}\n- 计划课时：${profile.durationMinutes}分钟\n- 学习目标：${profile.learningObjectives}\n- 教学重点：${profile.keyPoints}\n- 教学难点：${profile.difficultPoints}\n- 学情：${profile.learnerProfile || '由教师现场判断'}\n- 评价方式：${ASSESSMENT_LABELS[profile.assessmentMode]}\n- 互动预算：最多${profile.interactionBudget}个场景\n- 参考依据：${profile.sourceReferences || '未填写；生成后必须由教师核验'}\n\n硬性要求：依据上述目标组织内容；总授课时间不得超过计划课时；每个活动必须服务于学习目标；不要为了炫技使用不匹配的互动工具；涉及实验、应急和健康安全时使用审慎、权威的表述；生成结果必须由任课教师复核，不得声称内容已经通过教师审核。`;
}
