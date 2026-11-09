import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import {
  ensureCourseDocumentSchema,
  listServerCourseDocuments,
  saveServerCourseDocument,
} from '@/lib/course-documents/server-store';
import {
  CourseDocumentConflictError,
  documentDraft,
  prepareDocumentSave,
} from '@/lib/course-documents/types';
import {
  listLocalCourseDocuments,
  saveLocalCourseDocument,
  type CourseDocumentDatabase,
} from '@/lib/course-documents/local-store';
import { draft } from './fixtures';

const localDbs: Dexie[] = [];
afterEach(async () => {
  for (const db of localDbs.splice(0)) await db.delete();
});
function local() {
  const db = new Dexie(`course-documents-${crypto.randomUUID()}`) as CourseDocumentDatabase;
  db.version(1).stores({ courseDocuments: '[stageId+kind],stageId' });
  localDbs.push(db);
  return db;
}

describe('independent local course documents', () => {
  it('persists both types and supports refresh without changing any course records', async () => {
    const db = local();
    await saveLocalCourseDocument(db, draft(), 0, false);
    await saveLocalCourseDocument(db, draft({ kind: 'student-notes' }), 0, false);
    db.close();
    await db.open();
    expect(await listLocalCourseDocuments(db, 'course-1')).toHaveLength(2);
    expect(await listLocalCourseDocuments(db, 'other')).toEqual([]);
    expect(db.tables.map((t) => t.name)).toEqual(['courseDocuments']);
  });
  it('allows exactly one writer from the same revision', async () => {
    const db = local();
    const results = await Promise.allSettled([
      saveLocalCourseDocument(db, draft({ title: '窗口A' }), 0, false),
      saveLocalCourseDocument(db, draft({ title: '窗口B' }), 0, false),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toBeInstanceOf(CourseDocumentConflictError);
  });
  it('preserves the edited previous version when adopting and restoring', () => {
    const original = prepareDocumentSave(null, draft(), 0, false, 1);
    const edited = prepareDocumentSave(original, draft({ title: '老师手动修改' }), 1, false, 2);
    const adopted = prepareDocumentSave(edited, draft({ title: '生成新稿' }), 2, true, 3);
    expect(adopted.previous?.title).toBe('老师手动修改');
    const nextEdit = prepareDocumentSave(
      adopted,
      { ...documentDraft(adopted), title: '新稿已调整' },
      3,
      false,
      4,
    );
    expect(nextEdit.previous?.title).toBe('老师手动修改');
    const restored = prepareDocumentSave(nextEdit, nextEdit.previous!, 4, true, 5);
    expect(restored.title).toBe('老师手动修改');
    expect(restored.previous?.title).toBe('新稿已调整');
  });
});

describe('owner-scoped server documents', () => {
  async function server() {
    const db = new PGlite();
    await db.waitReady;
    await db.exec(
      `CREATE TABLE document_stages(id TEXT PRIMARY KEY); CREATE TABLE stage_meta(stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,deleted_at TIMESTAMPTZ); INSERT INTO document_stages VALUES ('course-1'); INSERT INTO stage_meta VALUES ('course-1','owner-1',NULL)`,
    );
    await ensureCourseDocumentSchema(db);
    await ensureCourseDocumentSchema(db);
    const pool = {
      query: db.query.bind(db),
      connect: async () => ({ query: db.query.bind(db), release() {} }),
    } as unknown as ConnectableQueryable;
    return { db, pool };
  }
  it('isolates readers and writers and enforces CAS', async () => {
    const { db, pool } = await server();
    try {
      await saveServerCourseDocument(pool, 'owner-1', draft(), 0, false);
      expect(await listServerCourseDocuments(pool, 'owner-1', 'course-1')).toHaveLength(1);
      await expect(listServerCourseDocuments(pool, 'owner-2', 'course-1')).rejects.toThrow('无权');
      await expect(saveServerCourseDocument(pool, 'owner-2', draft(), 1, false)).rejects.toThrow(
        '无权',
      );
      await expect(
        saveServerCourseDocument(pool, 'owner-1', draft(), 0, false),
      ).rejects.toBeInstanceOf(CourseDocumentConflictError);
      expect((await listServerCourseDocuments(pool, 'owner-1', 'course-1'))[0].revision).toBe(1);
    } finally {
      await db.close();
    }
  });
  it('cleans up on tombstones and physical course deletion, and refuses resurrection', async () => {
    const { db, pool } = await server();
    try {
      await saveServerCourseDocument(pool, 'owner-1', draft(), 0, false);
      await db.query("UPDATE stage_meta SET deleted_at=NOW() WHERE stage_id='course-1'");
      expect((await db.query('SELECT * FROM course_documents')).rows).toEqual([]);
      await expect(saveServerCourseDocument(pool, 'owner-1', draft(), 0, false)).rejects.toThrow(
        '不存在',
      );
      await db.query("UPDATE stage_meta SET deleted_at=NULL WHERE stage_id='course-1'");
      await saveServerCourseDocument(pool, 'owner-1', draft(), 0, false);
      await db.query("DELETE FROM document_stages WHERE id='course-1'");
      expect((await db.query('SELECT * FROM course_documents')).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
