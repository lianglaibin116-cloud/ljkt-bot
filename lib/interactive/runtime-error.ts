export type InteractiveRuntimeIssueKind = 'runtime' | 'dependency';

export interface InteractiveRuntimeIssue {
  readonly kind: InteractiveRuntimeIssueKind;
  readonly message: string;
}

/** Keep older callers and persisted test fixtures readable as ordinary errors. */
export function normalizeInteractiveRuntimeIssue(
  issue: InteractiveRuntimeIssue | string,
): InteractiveRuntimeIssue {
  if (typeof issue === 'string') return { kind: 'runtime', message: issue.trim() };
  return {
    kind: issue.kind === 'dependency' ? 'dependency' : 'runtime',
    message: issue.message.trim(),
  };
}

export function formatInteractiveRuntimeIssue(issue: InteractiveRuntimeIssue): string {
  return `[${issue.kind}] ${issue.message}`;
}
