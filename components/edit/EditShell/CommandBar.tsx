'use client';

import { ArrowLeft, Redo2, Undo2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import type { EditorCommand } from '@/lib/edit/scene-editor-surface';
import { useCourseHistory } from '@/lib/edit/use-course-history';
import { classroomExitLabelKey, exitClassroom } from '@/lib/workbench/classroom-exit';

interface CommandBarProps {
  readonly title: string;
  readonly commands?: readonly EditorCommand[];
  /**
   * Right-edge slot owned by Stage. In Pro mode it carries the
   * HeaderControls (settings pill + Pro Switch + Download) since Stage
   * Header is unmounted to keep top chrome to a single bar.
   */
  readonly trailing?: ReactNode;
}

/**
 * Top bar of the Pro mode chrome. Undo/redo + title on the left, insert
 * primitives in the center, surface commands on the right. History /
 * insertItems / commands are all optional so the bar renders cleanly when
 * no surface is registered for the current scene type.
 *
 * Exiting Pro mode is handled by the global Pro Switch in the playback
 * Header (which stays mounted above this bar) — Pro mode is a toggle,
 * not a one-way state, so we deliberately do *not* place a "Done" pill
 * here that would compete with the Switch's affordance.
 */
export function CommandBar({ title, commands, trailing }: CommandBarProps) {
  const { t } = useI18n();
  // Undo and redo span the whole course, across slide, quiz, action, and page edits.
  const courseHistory = useCourseHistory();
  const router = useRouter();
  const searchParams = useSearchParams();
  const exitLabel = t(classroomExitLabelKey(searchParams));

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-background/95 px-6 backdrop-blur-sm dark:border-zinc-800/60">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Classroom exit mirrors playback Header's leftmost button so the
            user has the same global-out affordance across standalone modes. */}
        <IconButton
          title={exitLabel}
          aria-label={exitLabel}
          onClick={() => exitClassroom(router, searchParams)}
        >
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <IconButton
          title={t('edit.undo')}
          aria-label={t('edit.undo')}
          data-testid="edit-undo"
          disabled={!courseHistory.canUndo}
          onClick={courseHistory.undo}
        >
          <Undo2 className="h-4 w-4" />
        </IconButton>
        <IconButton
          title={t('edit.redo')}
          aria-label={t('edit.redo')}
          data-testid="edit-redo"
          disabled={!courseHistory.canRedo}
          onClick={courseHistory.redo}
        >
          <Redo2 className="h-4 w-4" />
        </IconButton>
        <span
          className={cn('ml-2 truncate text-sm font-semibold text-foreground/90')}
          title={title}
        >
          {title}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {commands && commands.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            {commands.map((command) => (
              <IconButton
                key={command.id}
                title={command.tooltip ?? command.label}
                disabled={command.disabled}
                onClick={command.onInvoke}
              >
                {command.icon ?? <span className="px-1 text-xs">{command.label}</span>}
              </IconButton>
            ))}
          </div>
        )}
        {trailing}
      </div>
    </header>
  );
}

function IconButton({
  title,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { readonly title: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-xl text-muted-foreground hover:bg-primary/10 hover:text-primary dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
