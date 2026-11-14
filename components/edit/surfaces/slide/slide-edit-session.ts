/**
 * The active slide and the single path its edits take to the stage store.
 * Course-level undo and redo live on `lib/edit/course-timeline.ts`; this store
 * only identifies the scene currently being edited.
 */

import { create } from 'zustand';
import {
  applyEditorTransaction,
  type EditorOperation,
  type EditorTransaction,
} from '@ljkt/editor/core';
import { commitCourseEdit } from '@/lib/edit/course-edit';
import { sameField, useCourseTimeline } from '@/lib/edit/course-timeline';
import { commitSlideEdit, deriveSlideEditOperations } from '@/lib/edit/scene-edit-bridge';
import { migrateSlideContent } from '@/lib/edit/slide-schema';
import { useStageStore } from '@/lib/store/stage';
import type { SlideContent } from '@/lib/types/stage';

interface SlideEditSessionState {
  sceneId: string | null;
  gestureActive: boolean;
  seed: (sceneId: string) => void;
  setGestureActive: (active: boolean) => void;
  applyOp: (op: EditorOperation) => void;
  applyTransaction: (transaction: EditorTransaction) => void;
  applyTransactionForScene: (sceneId: string, transaction: EditorTransaction) => void;
  commitContent: (sceneId: string, next: SlideContent) => void;
  commitMeasurement: (sceneId: string, next: SlideContent) => void;
  end: () => void;
}

const AUTO_SIZE_FIELDS: ReadonlySet<string> = new Set(['width', 'height']);
const TEXT_EDIT_FIELDS: ReadonlySet<string> = new Set([
  'content',
  'text',
  'data',
  'width',
  'height',
]);
const TEXT_OPERATIONS: ReadonlySet<string> = new Set([
  'text.updateContent',
  'shape.updateTextContent',
  'table.updateCell',
]);

function canonicalContent(sceneId: string): SlideContent | null {
  const scene = useStageStore.getState().scenes.find((candidate) => candidate.id === sceneId);
  return scene?.type === 'slide' ? migrateSlideContent(scene.content as SlideContent) : null;
}

function writeContent(sceneId: string, next: SlideContent): void {
  useStageStore.getState().updateScene(sceneId, { content: next });
}

function textBurstOf(
  sceneId: string,
  previous: SlideContent,
  next: SlideContent,
): string | undefined {
  const operations = deriveSlideEditOperations(previous, next);
  const [first] = operations;
  if (operations.length !== 1 || first.type !== 'element.update') return undefined;
  const keys = Object.keys(first.patch);
  if (!keys.every((key) => TEXT_EDIT_FIELDS.has(key))) return undefined;
  if (keys.every((key) => AUTO_SIZE_FIELDS.has(key))) return undefined;
  return `text:${sceneId}:${first.elementId}`;
}

function transactionTextBurst(sceneId: string, transaction: EditorTransaction): string | undefined {
  const ids = new Set(
    transaction.operations.map((operation) =>
      TEXT_OPERATIONS.has(operation.type) && 'elementId' in operation ? operation.elementId : null,
    ),
  );
  const [id] = ids;
  return ids.size === 1 && id ? `text:${sceneId}:${id}` : undefined;
}

export const useSlideEditSession = create<SlideEditSessionState>((set, get) => {
  const apply = (sceneId: string, transaction: EditorTransaction) => {
    const content = canonicalContent(sceneId);
    if (!content) return;
    const next = applyEditorTransaction(content, transaction);
    if (next === content) return;
    // Auto-layout updates are persisted but do not become user-visible undo steps.
    if (transaction.history === 'neutral') {
      writeContent(sceneId, next);
      return;
    }
    commitCourseEdit({ coalesceKey: transactionTextBurst(sceneId, transaction) }, () =>
      writeContent(sceneId, next),
    );
  };

  return {
    sceneId: null,
    gestureActive: false,
    seed: (sceneId) => set({ sceneId, gestureActive: false }),
    setGestureActive: (gestureActive) => set({ gestureActive }),
    applyOp: (op) => {
      const { sceneId } = get();
      const content = sceneId ? canonicalContent(sceneId) : null;
      if (!sceneId || !content) return;
      // Keep the legacy toolbar's stale-selection behavior: a deleted element
      // makes this single operation a no-op, while explicit batches stay strict.
      if (
        'elementId' in op &&
        !content.canvas.elements.some((element) => element.id === op.elementId)
      ) {
        return;
      }
      apply(sceneId, { origin: 'toolbar', history: 'record', operations: [op] });
    },
    applyTransaction: (transaction) => {
      const { sceneId } = get();
      if (sceneId) apply(sceneId, transaction);
    },
    applyTransactionForScene: (sceneId, transaction) => {
      if (get().sceneId === sceneId) apply(sceneId, transaction);
    },
    commitContent: (sceneId, next) => {
      const content = canonicalContent(sceneId);
      if (!content) return;
      const operations = deriveSlideEditOperations(content, next);
      const [onlyOperation] = operations;
      const measurementOnly =
        !get().gestureActive &&
        operations.length === 1 &&
        onlyOperation?.type === 'element.update' &&
        Object.keys(onlyOperation.patch).length > 0 &&
        Object.keys(onlyOperation.patch).every((key) => AUTO_SIZE_FIELDS.has(key));
      if (measurementOnly) {
        get().commitMeasurement(sceneId, next);
        return;
      }
      const committed = commitSlideEdit({ past: [], present: content, future: [] }, next);
      if (committed.present === content) return;
      commitCourseEdit({ coalesceKey: textBurstOf(sceneId, content, next) }, () =>
        writeContent(sceneId, committed.present),
      );
    },
    commitMeasurement: (sceneId, next) => {
      // Renderer measurements are persisted for fidelity, but are not a
      // deliberate edit and therefore do not add a course-history step. A
      // changed measurement invalidates redo, because replaying a future step
      // could otherwise restore the pre-measurement dimensions.
      const content = canonicalContent(sceneId);
      if (!content || sameField(content, next)) return;
      writeContent(sceneId, next);
      const stageId = useStageStore.getState().stage?.id;
      if (stageId) {
        useCourseTimeline.getState().updateLine(stageId, (line) => ({
          ...line,
          future: [],
          activeCoalesceKey: null,
        }));
      }
    },
    end: () => set({ sceneId: null, gestureActive: false }),
  };
});
