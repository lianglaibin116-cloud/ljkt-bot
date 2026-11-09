'use client';

/**
 * Per-scene runtime errors captured from interactive iframes (via the error
 * shim's postMessage, see lib/utils/iframe.ts). Keyed by sceneId. Deduped (a
 * render loop can log the same error repeatedly) and capped so a banner can
 * show the latest few. The active interactive scene reads this store. The
 * workbench agent does not: it loads scene HTML on the server and cannot see
 * this client snapshot.
 */
import { create } from 'zustand';
import {
  normalizeInteractiveRuntimeIssue,
  type InteractiveRuntimeIssue,
} from '@/lib/interactive/runtime-error';

const MAX_PER_SCENE = 8;

interface SceneRuntimeErrorsState {
  errors: Record<string, InteractiveRuntimeIssue[]>;
  /** Record one error for a scene (deduped, capped to the most recent). */
  addError: (sceneId: string, issue: InteractiveRuntimeIssue | string) => void;
  /** Drop a scene's errors (e.g. when it re-renders with new content). */
  clearScene: (sceneId: string) => void;
}

export const useSceneRuntimeErrors = create<SceneRuntimeErrorsState>((set) => ({
  errors: {},
  addError: (sceneId, issue) =>
    set((s) => {
      const normalized = normalizeInteractiveRuntimeIssue(issue);
      if (!normalized.message) return s;
      const cur = s.errors[sceneId] ?? [];
      if (
        cur.some(
          (existing) =>
            existing.kind === normalized.kind && existing.message === normalized.message,
        )
      )
        return s; // dedup
      const next = [...cur, normalized].slice(-MAX_PER_SCENE);
      return { errors: { ...s.errors, [sceneId]: next } };
    }),
  clearScene: (sceneId) =>
    set((s) => {
      if (!s.errors[sceneId]) return s;
      const errors = { ...s.errors };
      delete errors[sceneId];
      return { errors };
    }),
}));
