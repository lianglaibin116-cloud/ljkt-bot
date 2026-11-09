import type { Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import { ELEMENT_BOUND } from '@/components/edit/ActionsBar/cue-meta';

/**
 * Pure content-validity checks for the editor. These surface *meaningless* edit
 * states — an empty speech line, a cue pointing at nothing, a scene with no
 * actions, a titleless outline — so the UI can mark them (scenes, lint-style)
 * or gate a forward step (outline → generate). No UI or store dependencies.
 *
 * Empties are tolerated while editing; this module only *describes* them. Whom
 * to block and where is the caller's policy.
 */

/** A meaningless state tied to a specific action in a scene's timeline. */
export type ActionIssue =
  | { kind: 'emptySpeech'; actionId: string }
  | { kind: 'unboundCue'; actionId: string }
  | { kind: 'emptyDiscussion'; actionId: string };

/** A meaningless state found on a single scene (action-level issues + empty list). */
export type SceneIssue =
  | { kind: 'emptyActions' }
  | { kind: 'invalidShape' }
  | { kind: 'missingMedia'; elementId?: string }
  | { kind: 'danglingCue'; actionId: string; elementId: string }
  | ActionIssue;

/** A meaningless state found on a single outline. */
export type OutlineIssue = { kind: 'emptyTitle' };

const isBlank = (s: string | undefined): boolean => !s || s.trim() === '';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Per-action content issues, in timeline order: a blank speech line, a cue that
 * points at no element, a discussion with no topic. Drives the inline marks on
 * the ActionsBar clips.
 */
export function validateActions(actions: Action[]): ActionIssue[] {
  const issues: ActionIssue[] = [];
  for (const a of actions) {
    if (a.type === 'speech' && isBlank((a as { text?: string }).text)) {
      issues.push({ kind: 'emptySpeech', actionId: a.id });
    } else if (ELEMENT_BOUND.has(a.type) && isBlank((a as { elementId?: string }).elementId)) {
      issues.push({ kind: 'unboundCue', actionId: a.id });
    } else if (a.type === 'discussion' && isBlank((a as { topic?: string }).topic)) {
      issues.push({ kind: 'emptyDiscussion', actionId: a.id });
    }
  }
  return issues;
}

/** All content-validity issues on a scene, in action order (empty list first). */
export function validateScene(scene: Scene): SceneIssue[] {
  const raw = scene as unknown as Record<string, unknown>;
  const rawActions = raw.actions;
  const actions = Array.isArray(rawActions)
    ? rawActions.filter((action): action is Action => isRecord(action))
    : [];
  const invalidActions = Array.isArray(rawActions) && actions.length !== rawActions.length;
  const issues: SceneIssue[] = actions.length === 0 ? [{ kind: 'emptyActions' }] : [];
  if ((rawActions !== undefined && !Array.isArray(rawActions)) || invalidActions) {
    issues.push({ kind: 'invalidShape' });
  }
  issues.push(...validateActions(actions));

  const rawContent = raw.content;
  const rawWhiteboards = raw.whiteboards;
  let invalidContent =
    !isRecord(rawContent) || (rawWhiteboards !== undefined && !Array.isArray(rawWhiteboards));
  const slideCandidates: unknown[] = [];
  if (isRecord(rawContent) && rawContent.type === 'slide') {
    if (isRecord(rawContent.canvas)) slideCandidates.push(rawContent.canvas);
    else invalidContent = true;
  }
  if (Array.isArray(rawWhiteboards)) slideCandidates.push(...rawWhiteboards);
  const slides = slideCandidates.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      invalidContent = true;
      return [];
    }
    if (candidate.elements === undefined)
      return [{ candidate, elements: [] as Record<string, unknown>[] }];
    if (!Array.isArray(candidate.elements)) {
      invalidContent = true;
      return [];
    }
    const elements = candidate.elements.filter(isRecord);
    if (elements.length !== candidate.elements.length) invalidContent = true;
    return [{ candidate, elements }];
  });
  if (invalidContent) issues.push({ kind: 'invalidShape' });
  const elementIds = new Set(
    slides.flatMap(({ elements }) =>
      elements.flatMap((element) => (typeof element.id === 'string' ? [element.id] : [])),
    ),
  );
  for (const action of actions) {
    if (!ELEMENT_BOUND.has(action.type)) continue;
    const elementId = (action as { elementId?: string }).elementId?.trim();
    if (elementId && !elementIds.has(elementId)) {
      issues.push({ kind: 'danglingCue', actionId: action.id, elementId });
    }
  }

  const reportedMissingMedia = new Set<string>();
  for (const { candidate: slide, elements } of slides) {
    const refs: Array<{ ref?: string; elementId?: string }> = [];
    if (isRecord(slide.background) && slide.background.type === 'image') {
      const backgroundImage = isRecord(slide.background.image) ? slide.background.image : undefined;
      refs.push({
        ref: typeof backgroundImage?.src === 'string' ? backgroundImage.src : undefined,
      });
    }
    for (const element of elements) {
      const elementId = typeof element.id === 'string' ? element.id : undefined;
      const imageRef = typeof element.src === 'string' ? element.src : undefined;
      if (element.type === 'image') refs.push({ ref: imageRef, elementId });
      if (element.type === 'video') {
        refs.push({ ref: imageRef, elementId });
        refs.push({
          ref: typeof element.mediaRef === 'string' ? element.mediaRef : undefined,
          elementId,
        });
        refs.push({
          ref: typeof element.poster === 'string' ? element.poster : undefined,
          elementId,
        });
      }
    }
    for (const slot of refs) {
      if (slot.ref && /^gen_(?:img|vid)_[\w-]+$/i.test(slot.ref)) {
        const key = slot.elementId ?? 'background';
        if (reportedMissingMedia.has(key)) continue;
        reportedMissingMedia.add(key);
        issues.push({
          kind: 'missingMedia',
          ...(slot.elementId ? { elementId: slot.elementId } : {}),
        });
      }
    }
  }
  return issues;
}

/** Whether a scene has any content-validity issue. */
export function sceneHasIssues(scene: Scene): boolean {
  return validateScene(scene).length > 0;
}

/** Content-validity issues on an outline (blank title is the only blocking one). */
export function validateOutline(outline: SceneOutline): OutlineIssue[] {
  return isBlank(outline.title) ? [{ kind: 'emptyTitle' }] : [];
}

/** Whether any outline carries a blocking issue (used to gate generation). */
export function outlinesHaveBlockingIssues(outlines: SceneOutline[]): boolean {
  return outlines.some((o) => validateOutline(o).length > 0);
}

/** Count of outlines with a blocking issue (drives the gate's reason text). */
export function countBlockingOutlines(outlines: SceneOutline[]): number {
  return outlines.reduce((n, o) => n + (validateOutline(o).length > 0 ? 1 : 0), 0);
}
