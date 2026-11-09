import { describe, expect, it } from 'vitest';
import { generationSessionKey, readGenerationSession } from '@/lib/bot/generation-handoff';

const draft = (sessionId: string) => ({
  sessionId,
  requirements: { requirement: 'C++基础课程' },
  currentStep: 'generating',
});
const memory = (values: Record<string, unknown>) => ({
  getItem: (key: string) => (key in values ? JSON.stringify(values[key]) : null),
});

describe('Bot generation task handoff', () => {
  it('gives each task its own draft and does not read an unrelated legacy task', () => {
    const values = {
      [generationSessionKey('task-a')]: draft('task-a'),
      [generationSessionKey('task-b')]: draft('task-b'),
      generationSession: draft('unrelated'),
    };
    expect(readGenerationSession(memory(values), 'task-a')?.sessionId).toBe('task-a');
    expect(readGenerationSession(memory(values), 'task-b')?.sessionId).toBe('task-b');
    expect(readGenerationSession(memory(values), 'missing')).toBeNull();
  });
  it('keeps the existing full workbench generation session format usable', () => {
    expect(readGenerationSession(memory({ generationSession: draft('legacy') }))?.sessionId).toBe(
      'legacy',
    );
    expect(
      readGenerationSession(memory({ generationSession: draft('legacy') }), 'legacy')?.sessionId,
    ).toBe('legacy');
  });
  it('rejects malformed task ids and drafts without requirements', () => {
    expect(() => generationSessionKey('../wrong')).toThrow();
    expect(readGenerationSession(memory({ generationSession: { sessionId: 'empty' } }))).toBeNull();
  });
});
