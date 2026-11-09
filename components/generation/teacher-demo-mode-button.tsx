'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Check, Presentation } from 'lucide-react';
import { cn } from '@/lib/utils';

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type TeacherDemoModeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'aria-pressed' | 'children'
> &
  DataAttributes & {
    pressed: boolean;
    label: string;
    onPressedChange: (pressed: boolean) => void;
  };

export const TeacherDemoModeButton = forwardRef<HTMLButtonElement, TeacherDemoModeButtonProps>(
  function TeacherDemoModeButton(
    { pressed, label, onPressedChange, className, onClick, ...buttonProps },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        aria-pressed={pressed}
        data-testid="teacher-demo-mode"
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onPressedChange(!pressed);
        }}
        className={cn(
          'relative inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 motion-reduce:transition-none motion-reduce:active:scale-100 dark:focus-visible:outline-violet-300',
          pressed
            ? 'border-violet-400 bg-violet-100 text-violet-900 shadow-sm shadow-violet-200/60 dark:border-violet-200 dark:bg-violet-400 dark:text-slate-950'
            : 'border-violet-500/70 bg-transparent text-violet-700 hover:bg-violet-50 dark:border-violet-600 dark:text-violet-300 dark:hover:bg-violet-950/50',
          className,
        )}
      >
        {pressed ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Presentation aria-hidden="true" className="size-3.5" />
        )}
        <span>{label}</span>
      </button>
    );
  },
);
