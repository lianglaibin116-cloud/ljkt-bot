export type TeacherIntent = 'edit' | 'interactive';

export function teacherCourseHref(id: string, intent: TeacherIntent): string {
  return `/classroom/${encodeURIComponent(id)}?teacherAction=${intent}`;
}

export function readTeacherIntent(search: string): TeacherIntent | undefined {
  const value = new URLSearchParams(search).get('teacherAction');
  return value === 'edit' || value === 'interactive' ? value : undefined;
}
