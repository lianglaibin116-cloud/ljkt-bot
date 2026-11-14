import type { Scene } from '@/lib/types/stage';
import { resolvePBLContent } from '@/lib/pbl/legacy/read';
import { applyLearnerState, extractLearnerState, stripToDesignTemplate } from './learner-state';

/** The document form of a scene: design only, with learner runtime state stripped. */
export function pblSceneAsPersisted(scene: Scene): Scene {
  if (scene.content.type !== 'pbl') return scene;
  const resolved = resolvePBLContent(scene.content);
  if (resolved.kind !== 'v2') return scene;
  return {
    ...scene,
    content: {
      ...scene.content,
      projectV2: stripToDesignTemplate(resolved.projectV2),
    },
  } as Scene;
}

/** Apply the current learner's runtime state to a restored PBL design. */
export function withLearnerStateOf(target: Scene, current: Scene): Scene {
  if (target.content.type !== 'pbl' || current.content.type !== 'pbl') return target;
  const targetProject = resolvePBLContent(target.content);
  const currentProject = resolvePBLContent(current.content);
  if (targetProject.kind !== 'v2' || currentProject.kind !== 'v2') return target;
  return {
    ...target,
    content: {
      ...target.content,
      projectV2: applyLearnerState(
        targetProject.projectV2,
        extractLearnerState(currentProject.projectV2),
      ),
    },
  } as Scene;
}
