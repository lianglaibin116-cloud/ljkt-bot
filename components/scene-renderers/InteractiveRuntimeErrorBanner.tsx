'use client';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { InteractiveRuntimeIssue } from '@/lib/interactive/runtime-error';

const RUNTIME_ERROR_PREVIEW_MAX = 180;

function truncateRuntimeErrorPreview(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= RUNTIME_ERROR_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, RUNTIME_ERROR_PREVIEW_MAX - 1)}…`;
}

/**
 * Host-side notice for an interactive scene whose iframe already reported a
 * runtime error. It sits over the iframe chrome, outside the sandbox, so the
 * generated page cannot hide or rewrite it.
 */
export function InteractiveRuntimeErrorBanner({
  issue,
  onDismiss,
  onRetry,
}: {
  readonly issue: InteractiveRuntimeIssue;
  readonly onDismiss: () => void;
  readonly onRetry: () => void;
}) {
  const { t } = useI18n();
  const isDependency = issue.kind === 'dependency';
  return (
    <div
      data-testid="interactive-runtime-error"
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-10"
    >
      <Alert
        variant={isDependency ? 'default' : 'destructive'}
        className={`px-3 py-2 shadow-lg ${isDependency ? 'border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50' : ''}`}
      >
        <AlertTitle>
          {t(
            isDependency
              ? 'chat.interactiveRuntimeError.dependencyTitle'
              : 'chat.interactiveRuntimeError.title',
          )}
        </AlertTitle>
        <AlertDescription className="break-all">
          {truncateRuntimeErrorPreview(issue.message)}
          {isDependency ? (
            <span className="mt-1 block">{t('chat.interactiveRuntimeError.dependencyHint')}</span>
          ) : null}
        </AlertDescription>
        <AlertAction>
          {isDependency ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="interactive-runtime-error-retry"
              onClick={onRetry}
            >
              {t('chat.interactiveRuntimeError.reload')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="interactive-runtime-error-dismiss"
            onClick={onDismiss}
          >
            {t('chat.interactiveRuntimeError.dismiss')}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
