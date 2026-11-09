'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useStageStore } from '@/lib/store/stage';

const CourseDocumentsPanel = dynamic(
  () => import('@/components/course-documents/CourseDocumentsPanel'),
  { ssr: false },
);

/** Only the Bot's same-origin lesson frame interprets these UI navigation hints. */
export function BotFrameBridge() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stageId = useStageStore((state) => state.stage?.id);
  const owner = useStageStore((state) => state.isOwner && !state.readOnly);
  const [dismissedDocumentKey, setDismissedDocumentKey] = useState('');
  const action = searchParams.get('botAction');
  const requestedDocument = action === 'teacher-plan' || action === 'student-notes' ? action : null;
  const documentKey = requestedDocument && stageId ? `${stageId}:${requestedDocument}` : '';
  const document = documentKey && documentKey !== dismissedDocumentKey ? requestedDocument : null;
  useEffect(() => {
    if (window.parent === window) return;
    if (pathname === '/' || pathname === '/bot') {
      window.parent.postMessage({ type: 'ljkt-bot:return-to-chat' }, window.location.origin);
      return;
    }
    if (!pathname.startsWith('/classroom/')) return;
    const expected = decodeURIComponent(pathname.split('/')[2] ?? '');
    if (!expected || expected !== stageId) return;
    window.parent.postMessage(
      {
        type: 'ljkt-bot:workspace-ready',
        courseId: expected,
        botTaskId: searchParams.get('botTask') || undefined,
        botThreadId: searchParams.get('botThread') || undefined,
        botMessageId: searchParams.get('botMessage') || undefined,
        botActionId: searchParams.get('botActionId') || undefined,
      },
      window.location.origin,
    );
    if (!owner) return;
    if (action === 'edit') useStageStore.getState().setMode('edit');
  }, [pathname, stageId, owner, action, searchParams]);
  return document && stageId && owner ? (
    <CourseDocumentsPanel
      key={`${stageId}:${document}`}
      stageId={stageId}
      initialKind={document}
      onClose={() => setDismissedDocumentKey(documentKey)}
    />
  ) : null;
}
