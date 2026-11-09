export const TEACHER_DEMO_REQUIREMENT =
  '教师演示模式：课程用于教师现场讲解。只安排 AI 教师讲授，以知识讲解、案例展示和总结为主；不要生成学生角色对话、答题、投票、拖拽、游戏、倒计时、分组活动或项目任务，由教师手动控制播放和翻页。';

/** Add the presentation-only constraint without changing the text visible in the composer. */
export function withTeacherDemoRequirement(requirement: string, enabled: boolean): string {
  if (!enabled) return requirement;
  return `${requirement.trim()}\n\n${TEACHER_DEMO_REQUIREMENT}`;
}
