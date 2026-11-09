import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { modelAuthorizationResponse } from '@/lib/server/api-response';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { AppDocumentOutline } from '@/lib/document-store';
import { courseDocumentKindSchema } from '@/lib/course-documents/types';
import {
  courseDocumentSourceSchema,
  extractCourseDocumentSource,
} from '@/lib/course-documents/source';
import { generateCourseDocument } from '@/lib/course-documents/generate';
import {
  CourseDocumentNotFoundError,
  requireOwnedCourse,
} from '@/lib/course-documents/server-store';
import { readCourseDocumentJson } from '@/lib/course-documents/request';

export const runtime = 'nodejs';
export const maxDuration = 300;
const requestSchema = z
  .object({
    kind: courseDocumentKindSchema,
    stageId: z.string().min(1).max(200),
    storageMode: z.enum(['local', 'server']),
    source: courseDocumentSourceSchema.optional(),
  })
  .passthrough();

export function POST(req: NextRequest) {
  return withRequestOwnerId(req, async (ownerId, headers) => {
    headers.set('Cache-Control', 'private, no-store');
    const json = (value: unknown, status: number) => Response.json(value, { status, headers });
    try {
      const body = requestSchema.parse(await readCourseDocumentJson(req));
      let source = body.source;
      if (body.storageMode === 'server') {
        if (!process.env.DATABASE_URL?.trim()) return json({ error: '服务端持久化未启用。' }, 404);
        const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL);
        await requireOwnedCourse(pool, ownerId, body.stageId);
        const store = await getOwnerScopedDocumentStore(ownerId);
        const document = await store.loadDocument(body.stageId);
        if (!document) throw new CourseDocumentNotFoundError();
        const outline = document.outline as AppDocumentOutline | undefined;
        if (
          !outline?.generationComplete &&
          outline?.outlines?.some(
            (o) => !document.scenes.some((s) => s.outlineId === o.id || s.order === o.order),
          )
        ) {
          return json({ error: '课程尚未完成，请先补齐失败或待生成的页面。' }, 409);
        }
        source = extractCourseDocumentSource(document.stage, document.scenes, outline?.outlines);
      }
      if (!source || source.stageId !== body.stageId)
        return json({ error: '缺少有效的课程内容。' }, 400);
      if (!source.pages.some((page) => page.text.trim() || page.questions.length))
        return json({ error: '课程缺少可读教学内容，请先补充页面文字或讲解。' }, 400);
      const resolved = await resolveModelFromRequest(req, body, 'course-documents');
      const outputTokens = Math.min(
        resolved.modelInfo?.outputWindow ?? 8192,
        body.kind === 'teacher-plan' ? 4000 : 10_000,
      );
      const context = resolved.modelInfo?.contextWindow ?? 32_000;
      const chunkLimit = Math.min(
        24_000,
        Math.max(2000, Math.floor((context - outputTokens - 2000) * 0.7)),
      );
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      req.signal.addEventListener('abort', onAbort, { once: true });
      if (req.signal.aborted) abort.abort();
      const encoder = new TextEncoder();
      const snapshot = source;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            if (!abort.signal.aborted)
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
          };
          try {
            const document = await generateCourseDocument({
              source: snapshot,
              kind: body.kind,
              chunkLimit,
              progress: (current, total) => send('progress', { current, total }),
              call: async (system, prompt) =>
                (
                  await callLLM(
                    {
                      model: resolved.model,
                      system,
                      prompt,
                      abortSignal: abort.signal,
                      maxOutputTokens: outputTokens,
                    },
                    'course-documents',
                    undefined,
                    resolved.thinkingConfig,
                  )
                ).text,
            });
            send('complete', { document });
          } catch (error) {
            send('error', {
              error:
                error instanceof RangeError
                  ? error.message
                  : '资料整理失败，请重试。已有修改稿已保留。',
            });
          } finally {
            req.signal.removeEventListener('abort', onAbort);
            if (!abort.signal.aborted) controller.close();
          }
        },
        cancel() {
          abort.abort();
          req.signal.removeEventListener('abort', onAbort);
        },
      });
      headers.set('Content-Type', 'text/event-stream; charset=utf-8');
      headers.set('X-Accel-Buffering', 'no');
      return new Response(stream, { headers });
    } catch (error) {
      const authorization = modelAuthorizationResponse(error);
      if (authorization) {
        for (const [key, value] of headers) authorization.headers.append(key, value);
        return authorization;
      }
      if (error instanceof CourseDocumentNotFoundError) return json({ error: error.message }, 404);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return json({ error: '课程资料请求格式不正确。' }, 400);
      if (error instanceof RangeError) return json({ error: error.message }, 413);
      return json({ error: '无法开始生成，请检查当前文本模型配置后重试。' }, 500);
    }
  });
}
