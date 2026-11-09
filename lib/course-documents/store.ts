'use client';

import { create } from 'zustand';
import { listCourseDocuments, requestCourseDocument, saveCourseDocument } from './client';
import {
  documentDraft,
  type CourseDocument,
  type CourseDocumentDraft,
  type CourseDocumentKind,
} from './types';
import type { CourseDocumentSource } from './source';

export interface CourseDocumentEntry {
  document?: CourseDocument;
  draft?: CourseDocumentDraft;
  candidate?: CourseDocumentDraft;
  dirty: boolean;
  loaded: boolean;
  status: 'idle' | 'loading' | 'generating' | 'saving';
  error?: string;
  progress?: { current: number; total: number };
}
export const EMPTY_COURSE_DOCUMENT_ENTRY: CourseDocumentEntry = {
  dirty: false,
  loaded: false,
  status: 'idle',
};
export function courseDocumentKey(stageId: string, kind: CourseDocumentKind): string {
  return `${stageId}/${kind}`;
}

interface State {
  entries: Record<string, CourseDocumentEntry>;
  load: (stageId: string, reload?: boolean, onlyKind?: CourseDocumentKind) => Promise<void>;
  edit: (key: string, draft: CourseDocumentDraft) => void;
  save: (key: string) => Promise<void>;
  generate: (source: CourseDocumentSource, kind: CourseDocumentKind) => Promise<void>;
  adopt: (key: string) => Promise<void>;
  restore: (key: string) => Promise<void>;
  dismissCandidate: (key: string) => void;
  clearStage: (stageId: string) => void;
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';
const generationRequests = new Map<string, AbortController>();

/** Keyed by course AND document kind, so a late result cannot land in a newly selected tab. */
export const useCourseDocumentStore = create<State>((set, get) => {
  const patch = (key: string, changes: Partial<CourseDocumentEntry>, create = false) =>
    set((state) =>
      !create && !state.entries[key]
        ? state
        : {
            entries: {
              ...state.entries,
              [key]: { ...EMPTY_COURSE_DOCUMENT_ENTRY, ...state.entries[key], ...changes },
            },
          },
    );
  const saveDraft = async (key: string, draft: CourseDocumentDraft, checkpoint: boolean) => {
    const entry = get().entries[key];
    const saved = await saveCourseDocument(draft, entry?.document?.revision ?? 0, checkpoint);
    // A user may continue typing while a save is in flight; never erase that later draft.
    const latest = get().entries[key];
    const changed = latest?.draft && latest.draft !== draft && latest.dirty;
    patch(key, {
      document: saved,
      ...(changed ? {} : { draft: documentDraft(saved), dirty: false }),
      status: 'idle',
      error: undefined,
      loaded: true,
    });
    return saved;
  };
  return {
    entries: {},
    async load(stageId, reload = false, onlyKind) {
      const kinds = onlyKind ? [onlyKind] : (['teacher-plan', 'student-notes'] as const);
      if (!reload && kinds.every((kind) => get().entries[courseDocumentKey(stageId, kind)]?.loaded))
        return;
      for (const kind of kinds) {
        const key = courseDocumentKey(stageId, kind);
        if (!get().entries[key] || get().entries[key].status === 'idle')
          patch(key, { status: 'loading', error: undefined }, true);
      }
      try {
        const documents = await listCourseDocuments(stageId);
        for (const kind of kinds) {
          const key = courseDocumentKey(stageId, kind);
          const latest = get().entries[key];
          if (latest?.status === 'generating' || latest?.status === 'saving') continue;
          const saved = documents.find((document) => document.kind === kind);
          if (latest?.dirty && !reload) {
            patch(key, { status: 'idle', loaded: true });
            continue;
          }
          patch(key, {
            document: saved,
            draft: saved ? documentDraft(saved) : undefined,
            dirty: false,
            loaded: true,
            status: 'idle',
          });
        }
      } catch (error) {
        for (const kind of kinds) {
          const key = courseDocumentKey(stageId, kind);
          if (get().entries[key]?.status === 'loading')
            patch(key, { status: 'idle', error: errorText(error) });
        }
      }
    },
    edit(key, draft) {
      patch(key, { draft, dirty: true, error: undefined });
    },
    async save(key) {
      const entry = get().entries[key];
      if (!entry?.draft || entry.status !== 'idle') return;
      patch(key, { status: 'saving', error: undefined });
      try {
        await saveDraft(key, entry.draft, false);
      } catch (error) {
        patch(key, { status: 'idle', error: errorText(error) });
        throw error;
      }
    },
    async generate(source, kind) {
      const key = courseDocumentKey(source.stageId, kind);
      if (get().entries[key] && get().entries[key].status !== 'idle') return;
      patch(key, { status: 'generating', error: undefined, progress: undefined }, true);
      const controller = new AbortController();
      generationRequests.set(key, controller);
      try {
        const candidate = await requestCourseDocument(
          source,
          kind,
          (current, total) => {
            if (get().entries[key] && generationRequests.get(key) === controller)
              patch(key, { progress: { current, total } });
          },
          controller.signal,
        );
        const latest = get().entries[key];
        if (!latest || generationRequests.get(key) !== controller) return;
        if (latest.document || latest.dirty) {
          patch(key, { candidate, status: 'idle', progress: undefined });
        } else {
          patch(key, { candidate }); // Keep the successful result even if its first save fails.
          const saved = await saveCourseDocument(candidate, 0);
          patch(key, {
            document: saved,
            draft: documentDraft(saved),
            candidate: undefined,
            dirty: false,
            loaded: true,
            status: 'idle',
            progress: undefined,
          });
        }
      } catch (error) {
        if (get().entries[key])
          patch(key, { status: 'idle', progress: undefined, error: errorText(error) });
      } finally {
        if (generationRequests.get(key) === controller) generationRequests.delete(key);
      }
    },
    async adopt(key) {
      const entry = get().entries[key];
      if (!entry?.candidate || entry.status !== 'idle') return;
      patch(key, { status: 'saving', error: undefined });
      try {
        if (entry.dirty && entry.draft) await saveDraft(key, entry.draft, false);
        patch(key, { status: 'saving', draft: entry.candidate, dirty: false });
        await saveDraft(key, entry.candidate, true);
        patch(key, { candidate: undefined });
      } catch (error) {
        patch(key, {
          status: 'idle',
          draft: entry.draft,
          dirty: entry.dirty,
          error: errorText(error),
        });
      }
    },
    async restore(key) {
      const entry = get().entries[key];
      if (!entry?.document?.previous || entry.status !== 'idle') return;
      patch(key, { status: 'saving', error: undefined });
      try {
        if (entry.dirty && entry.draft) await saveDraft(key, entry.draft, false);
        const previous = get().entries[key].document!.previous!;
        patch(key, { status: 'saving', draft: previous, dirty: false });
        await saveDraft(key, previous, true);
      } catch (error) {
        patch(key, {
          status: 'idle',
          draft: entry.draft,
          dirty: entry.dirty,
          error: errorText(error),
        });
      }
    },
    dismissCandidate(key) {
      patch(key, { candidate: undefined });
    },
    clearStage(stageId) {
      for (const [key, controller] of generationRequests) {
        if (key.startsWith(`${stageId}/`)) {
          controller.abort();
          generationRequests.delete(key);
        }
      }
      set((state) => ({
        entries: Object.fromEntries(
          Object.entries(state.entries).filter(([key]) => !key.startsWith(`${stageId}/`)),
        ),
      }));
    },
  };
});

// Keep the draft warning active even when the panel is closed or its tab changes.
if (typeof window !== 'undefined') {
  let listening = false;
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  useCourseDocumentStore.subscribe((state) => {
    const dirty = Object.values(state.entries).some((entry) => entry.dirty);
    if (dirty && !listening) {
      window.addEventListener('beforeunload', warn);
      listening = true;
    }
    if (!dirty && listening) {
      window.removeEventListener('beforeunload', warn);
      listening = false;
    }
  });
}
