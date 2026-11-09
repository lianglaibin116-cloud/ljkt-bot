'use client';

import {
  isBrowserPersistenceEnabled,
  getPersistenceRequestHeaders,
} from '@/lib/persistence/bootstrap';
import { getCurrentModelConfig, getStageRoutesHeaderValue } from '@/lib/utils/model-config';
import {
  CourseDocumentConflictError,
  courseDocumentSchema,
  courseDocumentDraftSchema,
  type CourseDocument,
  type CourseDocumentDraft,
  type CourseDocumentKind,
} from './types';
import type { CourseDocumentSource } from './source';

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const data = (await response.json()) as Record<string, unknown>;
  if (response.status === 409) throw new CourseDocumentConflictError();
  if (!response.ok)
    throw new Error(
      typeof data.error === 'string' ? data.error : '课程资料服务暂时不可用，请重试。',
    );
  return data;
}

export async function listCourseDocuments(stageId: string): Promise<CourseDocument[]> {
  if (isBrowserPersistenceEnabled()) {
    const response = await fetch(`/api/stages/${encodeURIComponent(stageId)}/course-documents`, {
      cache: 'no-store',
      headers: await getPersistenceRequestHeaders(),
    });
    const data = await readResponse(response);
    if (!Array.isArray(data.documents)) throw new Error('资料读取失败。');
    return data.documents.map((document) => courseDocumentSchema.parse(document));
  }
  const [{ db }, { listLocalCourseDocuments }] = await Promise.all([
    import('@/lib/utils/database'),
    import('./local-store'),
  ]);
  return listLocalCourseDocuments(db, stageId);
}

export async function saveCourseDocument(
  draft: CourseDocumentDraft,
  expectedRevision: number,
  checkpoint = false,
): Promise<CourseDocument> {
  courseDocumentDraftSchema.parse(draft);
  if (isBrowserPersistenceEnabled()) {
    const response = await fetch(
      `/api/stages/${encodeURIComponent(draft.stageId)}/course-documents`,
      {
        method: 'PUT',
        headers: { ...(await getPersistenceRequestHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: draft, expectedRevision, checkpoint }),
      },
    );
    return courseDocumentSchema.parse((await readResponse(response)).document);
  }
  const [{ db }, { saveLocalCourseDocument }, { mutateDocument }, { isStageDeleted }] =
    await Promise.all([
      import('@/lib/utils/database'),
      import('./local-store'),
      import('@/lib/document-store'),
      import('@/lib/utils/deleted-stages'),
    ]);
  // Use the course deletion lock without writing the course aggregate.
  return mutateDocument(draft.stageId, async (document) => {
    if (!document || isStageDeleted(draft.stageId)) throw new Error('课程已删除，无法保存资料。');
    return saveLocalCourseDocument(db, draft, expectedRevision, checkpoint);
  });
}

export async function requestCourseDocument(
  source: CourseDocumentSource,
  kind: CourseDocumentKind,
  onProgress: (current: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CourseDocumentDraft> {
  const config = getCurrentModelConfig();
  const routes = getStageRoutesHeaderValue();
  const response = await fetch('/api/generate/course-documents', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-model': config.modelString,
      'x-api-key': config.apiKey,
      'x-base-url': config.baseUrl,
      ...(config.providerType ? { 'x-provider-type': config.providerType } : {}),
      ...(routes ? { 'x-model-routes': routes } : {}),
    },
    body: JSON.stringify({
      kind,
      stageId: source.stageId,
      storageMode: isBrowserPersistenceEnabled() ? 'server' : 'local',
      ...(isBrowserPersistenceEnabled() ? {} : { source }),
      thinkingConfig: config.thinkingConfig,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '无法生成资料，请重试。');
  }
  if (!response.body) throw new Error('生成连接已中断。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: CourseDocumentDraft | undefined;
  try {
    for (;;) {
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const payload = frame.match(/^data: (.+)$/m)?.[1];
        if (!payload) continue;
        const data = JSON.parse(payload);
        if (event === 'progress') onProgress(data.current, data.total);
        if (event === 'complete') result = courseDocumentDraftSchema.parse(data.document);
        if (event === 'error') throw new Error(data.error);
      }
      if (next.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!result || result.stageId !== source.stageId || result.kind !== kind)
    throw new Error('生成未完成，请重试。');
  return result;
}
