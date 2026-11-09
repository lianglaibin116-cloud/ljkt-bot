import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import {
  listServerCourseDocuments,
  saveServerCourseDocument,
  CourseDocumentNotFoundError,
} from '@/lib/course-documents/server-store';
import {
  CourseDocumentConflictError,
  courseDocumentDraftSchema,
} from '@/lib/course-documents/types';
import { readCourseDocumentJson } from '@/lib/course-documents/request';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const saveSchema = z.object({
  document: courseDocumentDraftSchema,
  expectedRevision: z.number().int().nonnegative(),
  checkpoint: z.boolean().default(false),
});

function handle(req: NextRequest, context: Context, write: boolean) {
  return withRequestOwnerId(req, async (ownerId, headers) => {
    headers.set('Cache-Control', 'private, no-store');
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (!process.env.DATABASE_URL?.trim()) return json({ error: '服务端持久化未启用。' }, 404);
    try {
      const { id } = await context.params;
      const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL);
      if (!write) return json({ documents: await listServerCourseDocuments(pool, ownerId, id) });
      const body = saveSchema.parse(await readCourseDocumentJson(req));
      if (body.document.stageId !== id) return json({ error: '课程编号不匹配。' }, 400);
      const document = await saveServerCourseDocument(
        pool,
        ownerId,
        body.document,
        body.expectedRevision,
        body.checkpoint,
      );
      return json({ document });
    } catch (error) {
      if (error instanceof CourseDocumentNotFoundError) return json({ error: error.message }, 404);
      if (error instanceof CourseDocumentConflictError) return json({ error: error.message }, 409);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return json({ error: '资料格式不正确。' }, 400);
      if (error instanceof RangeError) return json({ error: error.message }, 413);
      console.error('[course-documents] persistence failed', error);
      return json({ error: '资料保存服务暂时不可用，请重试。' }, 500);
    }
  });
}
export function GET(req: NextRequest, context: Context) {
  return handle(req, context, false);
}
export function PUT(req: NextRequest, context: Context) {
  return handle(req, context, true);
}
