import { z } from 'zod';
import type { SessionDocumentSource } from '@/lib/types/generation';

export const courseActionSchema = z.object({
  type: z.literal('open-course'),
  courseId: z.string().min(1).max(200),
  title: z.string().max(250),
  view: z.enum(['playback', 'edit', 'teacher-plan', 'student-notes', 'export']),
});
export const botActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('prepare-course'),
    title: z.string().min(1).max(200),
    requirement: z.string().min(1).max(20000),
    interactive: z.boolean(),
    teacherDemo: z.boolean(),
  }),
  courseActionSchema,
  z.object({ type: z.literal('open-workspace') }),
]);
export type BotAction = z.infer<typeof botActionSchema>;
export interface BotWorkspaceState {
  url: string;
  title: string;
  mode?: 'generation' | 'classroom';
}
export type BotActionStatus = 'ready' | 'running' | 'failed' | 'cancelled' | 'complete';
export interface BotMessageAction {
  id: string;
  action: BotAction;
  status?: BotActionStatus;
  taskId?: string;
  sessionId?: string;
  courseId?: string;
  error?: string;
  updatedAt?: number;
}
export interface BotMaterial extends SessionDocumentSource {
  extractedText?: string;
  extractedPageCount?: number;
  extractionTruncated?: boolean;
  extractionError?: string;
}
export interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: BotMessageAction[];
  status?: 'complete' | 'streaming' | 'cancelled' | 'failed';
  error?: string;
  materials?: SessionDocumentSource[];
}
export interface BotThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Course context and embedded workspace belong to this conversation. */
  selectedCourseId?: string;
  workspace?: BotWorkspaceState | null;
  /** Source documents are scoped to and persisted with this conversation. */
  materials?: BotMaterial[];
  messages: BotMessage[];
}
export const botChatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(24000) }))
    .min(1)
    .max(60),
  courses: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(250),
        sceneCount: z.number().int().nonnegative(),
      }),
    )
    .max(500),
  courseContext: z.string().max(60000).optional(),
  materialNames: z.array(z.string().max(250)).max(12).optional(),
  materialContext: z.string().max(100000).optional(),
  historyOmittedCount: z.number().int().nonnegative().max(10000).optional(),
  thinkingConfig: z.unknown().optional(),
});
export type BotEvent =
  | { type: 'text'; text: string }
  | { type: 'action'; id: string; action: BotAction }
  | { type: 'error'; error: string; requestId?: string; code?: string; retryable?: boolean }
  | { type: 'done' };

export function actionPath(action: Extract<BotAction, { type: 'open-course' }>): string {
  return `/classroom/${encodeURIComponent(action.courseId)}?botAction=${action.view}&botEmbedded=1`;
}

/** NDJSON records may cross arbitrary network and UTF-8 chunk boundaries. */
export async function readBotEvents(
  stream: ReadableStream<Uint8Array>,
  receive: (event: BotEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as BotEvent;
    if (event.type === 'action') event.action = botActionSchema.parse(event.action);
    if (['text', 'action', 'error', 'done'].includes(event.type)) receive(event);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 256000) throw new Error('响应内容过长，请重试。');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
    pending += decoder.decode();
    consume(pending);
  } finally {
    reader.releaseLock();
  }
}
