export type TeacherControlAction = 'toggle-play' | 'previous-scene' | 'next-scene';

export const TEACHER_CONTROL_EVENT = 'openmaic:teacher-control';

export function dispatchTeacherControl(action: TeacherControlAction): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<TeacherControlAction>(TEACHER_CONTROL_EVENT, { detail: action }),
  );
}
