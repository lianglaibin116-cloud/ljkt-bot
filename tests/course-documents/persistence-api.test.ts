import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ensureCourseDocumentSchema } from '@/lib/course-documents/server-store';
import { draft } from './fixtures';

const mocks = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ pool: mocks.pool }),
}));
vi.mock('@/lib/server/agent-runtime/owner', () => ({
  resolveRequestOwnerId: (req: Request, headers: Headers) => {
    headers.append('Set-Cookie', 'test-owner=1');
    return req.headers.get('x-test-owner') || 'owner-1';
  },
}));
import { GET, PUT } from '@/app/api/stages/[id]/course-documents/route';

let db: PGlite;
const context = { params: Promise.resolve({ id: 'course-1' }) };
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(
    'CREATE TABLE document_stages(id TEXT PRIMARY KEY); CREATE TABLE stage_meta(stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,deleted_at TIMESTAMPTZ)',
  );
  await ensureCourseDocumentSchema(db);
  mocks.pool = {
    query: db.query.bind(db),
    connect: async () => ({ query: db.query.bind(db), release() {} }),
  };
});
beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  await db.exec(
    "DELETE FROM document_stages; INSERT INTO document_stages VALUES ('course-1'); INSERT INTO stage_meta VALUES ('course-1','owner-1',NULL)",
  );
});
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
const request = (method: string, body?: unknown, owner = 'owner-1') =>
  new NextRequest('http://localhost/api/stages/course-1/course-documents', {
    method,
    headers: { 'x-test-owner': owner, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('course document persistence routes', () => {
  it('saves and reloads an owner document with private no-store responses', async () => {
    const response = await PUT(request('PUT', { document: draft(), expectedRevision: 0 }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain('test-owner');
    const read = await GET(request('GET'), context);
    expect(await read.json()).toMatchObject({ documents: [{ stageId: 'course-1', revision: 1 }] });
  });
  it('answers identical 404s for foreign and missing documents and never mutates them', async () => {
    const foreign = await GET(request('GET', undefined, 'owner-2'), context);
    const missing = await GET(request('GET'), { params: Promise.resolve({ id: 'missing' }) });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    const write = await PUT(
      request('PUT', { document: draft(), expectedRevision: 0 }, 'owner-2'),
      context,
    );
    expect(write.status).toBe(404);
    expect((await db.query('SELECT * FROM course_documents')).rows).toHaveLength(0);
  });
  it('refuses stale revisions, mismatching stage ids and malformed drafts', async () => {
    await PUT(request('PUT', { document: draft(), expectedRevision: 0 }), context);
    expect(
      (await PUT(request('PUT', { document: draft(), expectedRevision: 0 }), context)).status,
    ).toBe(409);
    expect(
      (
        await PUT(
          request('PUT', { document: draft({ stageId: 'other' }), expectedRevision: 0 }),
          context,
        )
      ).status,
    ).toBe(400);
    expect((await PUT(request('PUT', { document: {}, expectedRevision: 0 }), context)).status).toBe(
      400,
    );
  });
});
