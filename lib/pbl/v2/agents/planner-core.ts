/** Compatibility re-exports for the package-owned PBL planning core. */
export {
  MAX_SYNTHESIS_STAGES,
  PlannerV2Error,
  SCENARIO_SCHEMA_VERSION,
  applyPlannerProficiency,
  buildPlannerSystemPrompt,
  buildScenarioDesignBlock,
  emptyProject,
  instructorProjectAnchor,
  newId,
  normalizeSynthesisChecks,
  plannerCompletionGaps,
} from '@ljkt/generation';
export type { PlannerV2Callbacks, PlannerV2ProgressEvent } from '@ljkt/generation';
