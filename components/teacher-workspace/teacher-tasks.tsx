'use client';

import { BookOpen, FilePenLine, Plus } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Button } from '@/components/ui/button';

export type TeacherCreationMode = 'new' | 'optimize';

interface TeacherTasksProps {
  disabled: boolean;
  onCreate: (mode: TeacherCreationMode) => void;
  onLibrary: () => void;
}

export function TeacherTasks({ disabled, onCreate, onLibrary }: TeacherTasksProps) {
  const { t } = useI18n();
  const tasks = [
    {
      id: 'new' as const,
      label: t('teacherWorkspace.create'),
      description: t('teacherWorkspace.createHint'),
      icon: Plus,
    },
    {
      id: 'optimize' as const,
      label: t('teacherWorkspace.optimize'),
      description: t('teacherWorkspace.optimizeHint'),
      icon: FilePenLine,
    },
  ];

  return (
    <section
      className="mb-6 w-full"
      aria-label={t('teacherWorkspace.title')}
      data-testid="teacher-tasks"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            {t('teacherWorkspace.title')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('teacherWorkspace.slogan')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onLibrary}>
          <BookOpen className="size-4" aria-hidden="true" />
          {t('teacherWorkspace.library')}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {tasks.map(({ id, label, description, icon: Icon }) => (
          <button
            type="button"
            key={id}
            disabled={disabled}
            onClick={() => onCreate(id)}
            className={`lj-task-card ${id === 'new' ? 'lj-task-card-primary' : ''}`}
          >
            <span className="lj-task-icon" aria-hidden="true">
              <Icon className="size-5" />
            </span>
            <span className="mt-5 block text-base font-semibold">{label}</span>
            <span className="mt-1.5 block text-sm leading-6 text-muted-foreground">
              {description}
            </span>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">
              {id === 'new'
                ? t('teacherWorkspace.createAction')
                : t('teacherWorkspace.optimizeAction')}
              <span aria-hidden="true">→</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
