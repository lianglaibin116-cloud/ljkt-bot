import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draft, source } from './fixtures';
import {
  prepareDocumentSave,
  type CourseDocument,
  type CourseDocumentDraft,
} from '@/lib/course-documents/types';

const client = vi.hoisted(() => ({
  listCourseDocuments: vi.fn(),
  requestCourseDocument: vi.fn(),
  saveCourseDocument: vi.fn(),
}));
vi.mock('@/lib/course-documents/client', () => client);
import { courseDocumentKey, useCourseDocumentStore } from '@/lib/course-documents/store';
const key = courseDocumentKey('course-1', 'teacher-plan');
let saved: CourseDocument | null;
beforeEach(() => {
  vi.clearAllMocks();
  saved = prepareDocumentSave(null, draft(), 0, false);
  useCourseDocumentStore.setState({ entries: {} });
  client.listCourseDocuments.mockImplementation(async () => (saved ? [saved] : []));
  client.requestCourseDocument.mockResolvedValue(draft({ title: 'AI新稿' }));
  client.saveCourseDocument.mockImplementation(
    async (input: CourseDocumentDraft, revision: number, checkpoint: boolean) => {
      saved = prepareDocumentSave(saved, input, revision, checkpoint);
      return saved;
    },
  );
});

describe('author document lifecycle', () => {
  it('keeps regeneration as a candidate and saves manual edits before adopting it', async () => {
    const store = useCourseDocumentStore.getState();
    await store.load('course-1');
    store.edit(key, draft({ title: '老师修改' }));
    await store.generate(source(), 'teacher-plan');
    let entry = useCourseDocumentStore.getState().entries[key];
    expect(entry.draft?.title).toBe('老师修改');
    expect(entry.candidate?.title).toBe('AI新稿');
    expect(client.saveCourseDocument).not.toHaveBeenCalled();
    await store.adopt(key);
    entry = useCourseDocumentStore.getState().entries[key];
    expect(entry.document?.title).toBe('AI新稿');
    expect(entry.document?.previous?.title).toBe('老师修改');
    await store.restore(key);
    expect(useCourseDocumentStore.getState().entries[key].draft?.title).toBe('老师修改');
  });
  it('preserves the draft when generation or save fails', async () => {
    const store = useCourseDocumentStore.getState();
    await store.load('course-1');
    store.edit(key, draft({ title: '需要保留' }));
    client.requestCourseDocument.mockRejectedValue(new Error('provider offline'));
    await store.generate(source(), 'teacher-plan');
    expect(useCourseDocumentStore.getState().entries[key].draft?.title).toBe('需要保留');
    client.saveCourseDocument.mockRejectedValue(new Error('storage offline'));
    await expect(store.save(key)).rejects.toThrow();
    expect(useCourseDocumentStore.getState().entries[key]).toMatchObject({
      dirty: true,
      draft: { title: '需要保留' },
    });
  });
  it('does not erase typing that arrives while a save is in flight', async () => {
    const store = useCourseDocumentStore.getState();
    await store.load('course-1');
    store.edit(key, draft({ title: '第一次修改' }));
    let finish!: (value: CourseDocument) => void;
    client.saveCourseDocument.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const save = store.save(key);
    store.edit(key, draft({ title: '保存时继续输入' }));
    finish(prepareDocumentSave(saved, draft({ title: '第一次修改' }), 1, false));
    await save;
    expect(useCourseDocumentStore.getState().entries[key]).toMatchObject({
      dirty: true,
      draft: { title: '保存时继续输入' },
      document: { title: '第一次修改', revision: 2 },
    });
  });
  it('stores late results in their original course, not the newly selected course', async () => {
    const store = useCourseDocumentStore.getState();
    await store.load('course-1');
    let finish!: (value: CourseDocumentDraft) => void;
    client.requestCourseDocument.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = store.generate(source(), 'teacher-plan');
    client.listCourseDocuments.mockResolvedValue([]);
    await store.load('course-2');
    finish(draft({ title: '原课程的新稿' }));
    await running;
    expect(useCourseDocumentStore.getState().entries[key].candidate?.title).toBe('原课程的新稿');
    expect(
      useCourseDocumentStore.getState().entries[courseDocumentKey('course-2', 'teacher-plan')]
        .candidate,
    ).toBeUndefined();
  });
  it('does not resurrect a deleted course after a pending generation resolves', async () => {
    const store = useCourseDocumentStore.getState();
    await store.load('course-1');
    let finish!: (value: CourseDocumentDraft) => void;
    client.requestCourseDocument.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = store.generate(source(), 'teacher-plan');
    store.clearStage('course-1');
    finish(draft());
    await running;
    expect(useCourseDocumentStore.getState().entries[key]).toBeUndefined();
    expect(client.saveCourseDocument).not.toHaveBeenCalled();
  });
  it('reloading one document cannot discard unsaved edits in the other tab', async () => {
    const store = useCourseDocumentStore.getState();
    await store.load('course-1');
    store.edit(key, draft({ title: '教师的未保存修改' }));
    await store.load('course-1', true, 'student-notes');
    expect(useCourseDocumentStore.getState().entries[key]).toMatchObject({
      dirty: true,
      draft: { title: '教师的未保存修改' },
    });
  });
});
