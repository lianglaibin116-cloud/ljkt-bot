import type { GenerationSessionState } from '@/app/generation-preview/types';

const LEGACY_SESSION_KEY = 'generationSession';
const BOT_SESSION_PREFIX = 'ljkt-bot:generation:';

/** Each task owns its draft; an unmounting old frame cannot erase the next task. */
export function generationSessionKey(sessionId?: string | null): string {
  if (!sessionId) return LEGACY_SESSION_KEY;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) throw new Error('无效的制作任务编号。');
  return BOT_SESSION_PREFIX + sessionId;
}

export function generationParamsKey(courseId: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(courseId)) throw new Error('无效的课程编号。');
  return `ljkt-bot:generation-params:${courseId}`;
}

export function readGenerationSession(
  storage: Pick<Storage, 'getItem'>,
  sessionId?: string | null,
): GenerationSessionState | null {
  const saved =
    storage.getItem(generationSessionKey(sessionId)) ??
    (sessionId ? storage.getItem(LEGACY_SESSION_KEY) : null);
  if (!saved) return null;
  const value = JSON.parse(saved) as GenerationSessionState;
  if (sessionId && value.sessionId !== sessionId) return null;
  if (!value.requirements || typeof value.requirements.requirement !== 'string') return null;
  return value;
}
