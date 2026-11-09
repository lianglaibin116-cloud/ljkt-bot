import { describe, expect, it } from 'vitest';
import {
  actionPath,
  botChatRequestSchema,
  readBotEvents,
  type BotEvent,
} from '@/lib/bot/contracts';
import { buildBotCourseSession } from '@/lib/bot/course-session';
import { createBotTools } from '@/lib/bot/tools';

describe('Bot actions reuse actual teaching flows', () => {
  it('preserves reviewed requirements and independent uploaded materials', () => {
    const documents = [
      { id: 'd1', name: '材料.pdf', size: 20, storageKey: 'independent-key', order: 1 },
    ];
    const session = buildBotCourseSession(
      {
        type: 'prepare-course',
        title: '勾股定理',
        requirement: '八年级，6页，含互动和测验',
        interactive: true,
        teacherDemo: false,
      },
      { sessionId: 'bot-session', documents, webSearch: false },
    );
    expect(session.requireOutlineConfirmation).toBe(true);
    expect(session.requirements.interactiveMode).toBe(true);
    expect(session.documentSources).toEqual(documents);
    expect(session.sceneOutlines).toBeNull();
  });
  it('cannot invent a saved course when selecting professional editing', async () => {
    const tools = createBotTools([{ id: 'real', name: '真实课程', sceneCount: 6 }]);
    const unknown = await tools.open_course.execute!(
      { courseId: 'invented', view: 'edit' },
      {} as never,
    );
    expect(unknown).toHaveProperty('error');
    const valid = await tools.open_course.execute!({ courseId: 'real', view: 'edit' }, {} as never);
    expect(valid).toEqual({
      action: { type: 'open-course', courseId: 'real', title: '真实课程', view: 'edit' },
    });
  });
  it('never injects an arbitrary path from a model tool result', () => {
    expect(
      actionPath({
        type: 'open-course',
        courseId: '../private?x=1',
        title: 'x',
        view: 'student-notes',
      }),
    ).toBe('/classroom/..%2Fprivate%3Fx%3D1?botAction=student-notes&botEmbedded=1');
    expect(botChatRequestSchema.safeParse({ messages: [], courses: [] }).success).toBe(false);
  });
});

describe('stream recovery and boundaries', () => {
  it('handles Chinese and NDJSON split across every byte boundary', async () => {
    const events: BotEvent[] = [{ type: 'text', text: '灵境课堂📚' }, { type: 'done' }];
    const bytes = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join('\n'));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const received: BotEvent[] = [];
    await readBotEvents(stream, (event) => received.push(event));
    expect(received).toEqual(events);
  });
  it('refuses malformed or unsupported action payloads', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        type: 'action',
        id: 'x',
        action: { type: 'execute-shell', command: 'bad' },
      }),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    await expect(readBotEvents(stream, () => undefined)).rejects.toThrow();
  });
});
