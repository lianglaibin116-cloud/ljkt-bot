'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { BookOpenText } from 'lucide-react';
import { useStageStore } from '@/lib/store/stage';
import { useI18n } from '@/lib/hooks/use-i18n';
import { courseDocumentCopy } from '@/lib/course-documents/copy';

const CourseDocumentsPanel = dynamic(() => import('./CourseDocumentsPanel'), { ssr: false });

export function CourseDocumentsButton({ stageId }: { readonly stageId?: string }) {
  const currentId = useStageStore((state) => state.stage?.id);
  const canManage = useStageStore((state) => state.isOwner && !state.readOnly);
  const [open, setOpen] = useState(false);
  const { locale } = useI18n();
  const copy = courseDocumentCopy(locale);
  if (!currentId || !canManage || (stageId && stageId !== currentId)) return null;
  return (
    <>
      <button
        type="button"
        data-testid="course-documents-open"
        onClick={() => setOpen(true)}
        title={copy.title}
        aria-label={copy.title}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
      >
        <BookOpenText className="size-4" />
        <span className="hidden sm:inline">{copy.title}</span>
      </button>
      {open && (
        <CourseDocumentsPanel key={currentId} stageId={currentId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
