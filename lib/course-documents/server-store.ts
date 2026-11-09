import type { ConnectableQueryable } from '@openmaic/storage/server/reference';
import type { Queryable } from '@openmaic/storage/document/pg';
import {
  courseDocumentSchema,
  prepareDocumentSave,
  type CourseDocument,
  type CourseDocumentDraft,
  type CourseDocumentKind,
} from './types';

/** An additive sidecar. A tombstone and a hard course deletion both remove its documents. */
export async function ensureCourseDocumentSchema(db: Queryable): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS course_documents (
    owner_id TEXT NOT NULL,
    stage_id TEXT NOT NULL REFERENCES document_stages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('teacher-plan', 'student-notes')),
    payload JSONB NOT NULL,
    PRIMARY KEY (owner_id, stage_id, kind)
  )`);
  await db.query(`CREATE OR REPLACE FUNCTION clear_tombstoned_course_documents()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      DELETE FROM course_documents WHERE stage_id = NEW.stage_id;
      RETURN NEW;
    END $$`);
  await db.query(`CREATE OR REPLACE TRIGGER clear_course_documents_on_tombstone
    AFTER UPDATE OF deleted_at ON stage_meta FOR EACH ROW
    WHEN (NEW.deleted_at IS NOT NULL)
    EXECUTE FUNCTION clear_tombstoned_course_documents()`);
}

export class CourseDocumentNotFoundError extends Error {
  constructor() {
    super('课程不存在或无权访问。');
    this.name = 'CourseDocumentNotFoundError';
  }
}

export async function requireOwnedCourse(
  db: Queryable,
  ownerId: string,
  stageId: string,
  lock = false,
): Promise<void> {
  const result = await db.query(
    `SELECT stage_id FROM stage_meta
    WHERE stage_id = $1 AND owner_id = $2 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [stageId, ownerId],
  );
  if (!result.rows.length) throw new CourseDocumentNotFoundError();
}

export async function listServerCourseDocuments(
  db: Queryable,
  ownerId: string,
  stageId: string,
): Promise<CourseDocument[]> {
  await requireOwnedCourse(db, ownerId, stageId);
  const result = await db.query<{ payload: unknown } & Record<string, unknown>>(
    `SELECT d.payload FROM course_documents d
    JOIN stage_meta m ON m.stage_id = d.stage_id
    WHERE d.owner_id = $1 AND d.stage_id = $2 AND m.owner_id = $1 AND m.deleted_at IS NULL`,
    [ownerId, stageId],
  );
  return result.rows.map((row) => courseDocumentSchema.parse(row.payload));
}

export async function saveServerCourseDocument(
  pool: ConnectableQueryable,
  ownerId: string,
  draft: CourseDocumentDraft,
  expectedRevision: number,
  checkpoint: boolean,
): Promise<CourseDocument> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireOwnedCourse(client, ownerId, draft.stageId, true);
    const result = await client.query<{ payload: unknown } & Record<string, unknown>>(
      'SELECT payload FROM course_documents WHERE owner_id=$1 AND stage_id=$2 AND kind=$3 FOR UPDATE',
      [ownerId, draft.stageId, draft.kind],
    );
    const current = result.rows[0] ? courseDocumentSchema.parse(result.rows[0].payload) : null;
    const saved = prepareDocumentSave(current, draft, expectedRevision, checkpoint);
    await client.query(
      `INSERT INTO course_documents (owner_id,stage_id,kind,payload) VALUES ($1,$2,$3,$4::jsonb)
      ON CONFLICT (owner_id,stage_id,kind) DO UPDATE SET payload=EXCLUDED.payload`,
      [ownerId, draft.stageId, draft.kind, JSON.stringify(saved)],
    );
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Convenience type shared by the client repository's result map. */
export type CourseDocumentMap = Partial<Record<CourseDocumentKind, CourseDocument>>;
