import type Dexie from 'dexie';
import type { Table } from 'dexie';
import {
  courseDocumentSchema,
  prepareDocumentSave,
  type CourseDocument,
  type CourseDocumentDraft,
} from './types';

export type CourseDocumentDatabase = Dexie & {
  courseDocuments: Table<CourseDocument, [string, string]>;
};

export async function listLocalCourseDocuments(
  db: CourseDocumentDatabase,
  stageId: string,
): Promise<CourseDocument[]> {
  return (await db.courseDocuments.where('stageId').equals(stageId).toArray()).map((document) =>
    courseDocumentSchema.parse(document),
  );
}

export function saveLocalCourseDocument(
  db: CourseDocumentDatabase,
  draft: CourseDocumentDraft,
  expectedRevision: number,
  checkpoint: boolean,
): Promise<CourseDocument> {
  return db.transaction('rw', db.courseDocuments, async () => {
    const current = await db.courseDocuments.get([draft.stageId, draft.kind]);
    const saved = prepareDocumentSave(current ?? null, draft, expectedRevision, checkpoint);
    await db.courseDocuments.put(saved);
    return saved;
  });
}
