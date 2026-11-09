import { z } from 'zod';

export const COURSE_DOCUMENT_KINDS = ['teacher-plan', 'student-notes'] as const;
export const courseDocumentKindSchema = z.enum(COURSE_DOCUMENT_KINDS);
export type CourseDocumentKind = z.infer<typeof courseDocumentKindSchema>;

export const courseDocumentSectionSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(100_000),
  sourceSceneIds: z.array(z.string().min(1).max(200)).max(500),
});
export type CourseDocumentSection = z.infer<typeof courseDocumentSectionSchema>;

export const courseDocumentBodySchema = z.object({
  title: z.string().trim().min(1).max(400),
  sections: z.array(courseDocumentSectionSchema).min(1).max(2000),
  warnings: z.array(z.string().max(2000)).max(500).default([]),
});

export const courseDocumentDraftSchema = courseDocumentBodySchema.extend({
  schemaVersion: z.literal(1),
  stageId: z.string().min(1).max(200),
  kind: courseDocumentKindSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.number().int().nonnegative(),
});
export type CourseDocumentDraft = z.infer<typeof courseDocumentDraftSchema>;

export const courseDocumentSchema = courseDocumentDraftSchema.extend({
  revision: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
  previous: courseDocumentDraftSchema.optional(),
});
export type CourseDocument = z.infer<typeof courseDocumentSchema>;

export class CourseDocumentConflictError extends Error {
  constructor() {
    super('资料已在其他窗口更新，请重新载入后再保存。');
    this.name = 'CourseDocumentConflictError';
  }
}

export function documentDraft(document: CourseDocument): CourseDocumentDraft {
  return courseDocumentDraftSchema.parse(document);
}

/** One CAS rule for IndexedDB and PostgreSQL; edits preserve the regeneration backup. */
export function prepareDocumentSave(
  current: CourseDocument | null,
  draft: CourseDocumentDraft,
  expectedRevision: number,
  checkpoint: boolean,
  now = Date.now(),
): CourseDocument {
  if ((current?.revision ?? 0) !== expectedRevision) throw new CourseDocumentConflictError();
  const previous = checkpoint && current ? documentDraft(current) : current?.previous;
  return courseDocumentSchema.parse({
    ...courseDocumentDraftSchema.parse(draft),
    revision: expectedRevision + 1,
    updatedAt: now,
    ...(previous ? { previous } : {}),
  });
}

export function courseDocumentLabel(kind: CourseDocumentKind): string {
  return kind === 'teacher-plan' ? '教师课程计划' : '学生课堂笔记';
}
