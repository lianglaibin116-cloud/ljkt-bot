import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTeacherIntent, teacherCourseHref } from '@/lib/teacher-workspace/navigation';
import { isMaicEditorEnabled, isTeacherWorkspaceEnabled } from '@/lib/config/feature-flags';
import { GET } from '@/app/api/health/live/route';

afterEach(() => vi.unstubAllEnvs());

describe('teacher workspace entry contract', () => {
  it('is opt-in and implies editing without changing legacy configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_TEACHER_WORKSPACE_ENABLED', '');
    vi.stubEnv('NEXT_PUBLIC_MAIC_EDITOR_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_PRO_WORKBENCH_ENABLED', 'false');
    expect(isTeacherWorkspaceEnabled()).toBe(false);
    expect(isMaicEditorEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_TEACHER_WORKSPACE_ENABLED', '1');
    expect(isTeacherWorkspaceEnabled()).toBe(true);
    expect(isMaicEditorEnabled()).toBe(true);
    expect(process.env.NEXT_PUBLIC_MAIC_EDITOR_ENABLED).toBe('false');
  });

  it('encodes course ids without allowing query/route injection', () => {
    expect(teacherCourseHref('a/b?x=1#part', 'edit')).toBe(
      '/classroom/a%2Fb%3Fx%3D1%23part?teacherAction=edit',
    );
  });

  it.each(['', '?teacherAction=delete', '?teacherAction=https://example.com', '?other=edit'])(
    'ignores unsupported intents: %s',
    (search) => expect(readTeacherIntent(search)).toBeUndefined(),
  );

  it.each(['edit', 'interactive'] as const)('recognizes only the intended %s entry', (intent) => {
    expect(readTeacherIntent(`?teacherAction=${intent}&other=1`)).toBe(intent);
  });

  it('exposes a minimal non-cached liveness result, not credentials or readiness claims', async () => {
    vi.stubEnv('DATABASE_URL', 'must-not-appear');
    const response = GET();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', check: 'liveness' });
  });
});
