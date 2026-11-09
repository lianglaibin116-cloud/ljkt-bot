'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpenText,
  Download,
  Loader2,
  Plus,
  Printer,
  Save,
  Trash2,
} from 'lucide-react';
import { Streamdown, defaultRemarkPlugins } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore, flushStageSave } from '@/lib/store/stage';
import {
  extractCourseDocumentSource,
  fingerprintCourseSource,
  courseDocumentsReady,
} from '@/lib/course-documents/source';
import {
  courseDocumentDraftSchema,
  type CourseDocumentDraft,
  type CourseDocumentKind,
} from '@/lib/course-documents/types';
import { courseDocumentCopy } from '@/lib/course-documents/copy';
import { actionableCourseDocumentWarnings } from '@/lib/course-documents/review-warnings';
import { withoutStudentChecklists } from '@/lib/course-documents/student-notes';
import {
  courseDocumentKey,
  EMPTY_COURSE_DOCUMENT_ENTRY,
  useCourseDocumentStore,
} from '@/lib/course-documents/store';
import { remarkSelectiveSingleDollarMath } from '@/lib/workbench/markdown-math';
import { safeKatexOptions } from '@/lib/standalone-player/math-render';

const math = createMathPlugin({ singleDollarTextMath: false });
const rehypeMath = math.rehypePlugin;
if (Array.isArray(rehypeMath)) math.rehypePlugin = [rehypeMath[0], safeKatexOptions()];
else if (typeof rehypeMath === 'function') math.rehypePlugin = [rehypeMath, safeKatexOptions()];
const plugins = { math };
const remarkPlugins = [remarkSelectiveSingleDollarMath, ...Object.values(defaultRemarkPlugins)];

export default function CourseDocumentsPanel({
  stageId,
  onClose,
  initialKind = 'teacher-plan',
}: {
  readonly stageId: string;
  readonly onClose: () => void;
  readonly initialKind?: CourseDocumentKind;
}) {
  const { locale } = useI18n();
  const copy = courseDocumentCopy(locale);
  const [kind, setKind] = useState<CourseDocumentKind>(initialKind);
  const [editing, setEditing] = useState(false);
  const [reviewingCandidate, setReviewingCandidate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const previewRef = useRef<HTMLElement>(null);
  const stage = useStageStore((s) => s.stage);
  const scenes = useStageStore((s) => s.scenes);
  const outlines = useStageStore((s) => s.outlines);
  const generatingOutlines = useStageStore((s) => s.generatingOutlines);
  const failedOutlines = useStageStore((s) => s.failedOutlines);
  const generationStatus = useStageStore((s) => s.generationStatus);
  const key = courseDocumentKey(stageId, kind);
  const entry = useCourseDocumentStore((s) => s.entries[key] ?? EMPTY_COURSE_DOCUMENT_ENTRY);
  const actions = useCourseDocumentStore.getState();
  const source = useMemo(() => {
    if (!stage || stage.id !== stageId || !scenes.length) return undefined;
    try {
      return extractCourseDocumentSource(stage, scenes, outlines);
    } catch {
      return undefined;
    }
  }, [stage, stageId, scenes, outlines]);
  const ready =
    courseDocumentsReady({ scenes, generatingOutlines, failedOutlines, generationStatus }) &&
    stage?.id === stageId;
  const busy = entry.status !== 'idle' || exporting;
  const viewingCandidate = !!entry.candidate && (reviewingCandidate || !entry.draft);
  const currentDraft = viewingCandidate ? entry.candidate : entry.draft;
  const displayed = useMemo(
    () => (currentDraft ? withoutStudentChecklists(currentDraft) : undefined),
    [currentDraft],
  );
  const reviewWarnings = actionableCourseDocumentWarnings(displayed?.warnings ?? []);
  const stale =
    !!fingerprint && !!entry.document && fingerprint !== entry.document.sourceFingerprint;

  useEffect(() => {
    void useCourseDocumentStore.getState().load(stageId);
  }, [stageId]);
  useEffect(() => {
    let current = true;
    if (source)
      void fingerprintCourseSource(source).then((hash) => {
        if (current) setFingerprint(hash);
      });
    return () => {
      current = false;
    };
  }, [source]);

  const edit = (draft: CourseDocumentDraft) => actions.edit(key, draft);
  const save = async () => {
    if (!courseDocumentDraftSchema.safeParse(entry.draft).success) {
      toast.error(copy.required);
      return;
    }
    try {
      await actions.save(key);
      setEditing(false);
    } catch {
      /* The durable draft and error stay in the panel. */
    }
  };
  const generate = async () => {
    try {
      await flushStageSave();
      const state = useStageStore.getState();
      if (
        state.stage?.id !== stageId ||
        !state.isOwner ||
        state.readOnly ||
        !courseDocumentsReady(state)
      ) {
        toast.error(copy.notReady);
        return;
      }
      await actions.generate(
        extractCourseDocumentSource(state.stage, state.scenes, state.outlines),
        kind,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.failed);
    }
  };
  const exportDocument = async (format: 'word' | 'pdf') => {
    if (!entry.document || entry.dirty || viewingCandidate || !previewRef.current) {
      toast.info(copy.exportHint);
      return;
    }
    setExporting(true);
    try {
      // Capture before awaiting imports, so a tab switch cannot change the exported document.
      const html = previewRef.current.outerHTML;
      const saved = entry.document;
      const api = await import('@/lib/course-documents/export');
      if (format === 'word')
        saveAs(await api.buildCourseDocumentWord(html), api.courseDocumentFileName(saved, 'docx'));
      else api.printCourseDocument(saved.title, html);
    } catch {
      toast.error(copy.failed);
    } finally {
      setExporting(false);
    }
  };
  const reload = () => {
    if (entry.dirty && !window.confirm(copy.reloadConfirm)) return;
    void actions.load(stageId, true, kind);
  };
  const sectionSources = (ids: string[]) =>
    ids
      .map((id) => {
        const page = source?.pages.find((p) => p.id === id);
        return page ? `${page.order}. ${page.title}` : copy.missingSource;
      })
      .join(' · ');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="course-documents-panel"
        className="flex h-[90vh] max-h-[900px] w-[96vw] max-w-[1100px] flex-col gap-3 overflow-hidden p-4 sm:p-6"
      >
        <DialogHeader className="pr-9">
          <DialogTitle className="flex items-center gap-2">
            <BookOpenText className="size-5 text-primary" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 border-b pb-3" role="tablist" aria-label={copy.title}>
          {(['teacher-plan', 'student-notes'] as const).map((value) => (
            <button
              type="button"
              role="tab"
              aria-selected={kind === value}
              key={value}
              data-testid={`course-document-tab-${value}`}
              onClick={() => {
                setKind(value);
                setEditing(false);
                setReviewingCandidate(false);
              }}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${kind === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              {value === 'teacher-plan' ? copy.teacher : copy.student}
            </button>
          ))}
        </div>
        {stale && (
          <p
            role="status"
            className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {copy.stale}
          </p>
        )}
        {entry.error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1">{entry.error}</span>
            {entry.draft && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(
                      [
                        entry.draft!.title,
                        ...withoutStudentChecklists(entry.draft!).sections.map(
                          (s) => `${s.title}\n${s.content}`,
                        ),
                      ].join('\n\n'),
                    )
                    .then(() => toast.success(copy.copied))
                    .catch(() => toast.error(copy.failed));
                }}
              >
                {copy.copy}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={reload} disabled={busy}>
              {copy.reload}
            </Button>
          </div>
        )}
        {entry.candidate && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
            <span className="min-w-48 flex-1">{copy.candidate}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReviewingCandidate(!viewingCandidate);
                setEditing(false);
              }}
            >
              {viewingCandidate ? copy.showCurrent : copy.showCandidate}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                void actions.adopt(key);
              }}
            >
              {copy.adopt}
            </Button>
            {entry.document && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => actions.dismissCandidate(key)}
              >
                {copy.dismiss}
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void generate()}
            disabled={!ready || busy || !entry.loaded}
            data-testid="course-document-generate"
          >
            {entry.status === 'generating' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <BookOpenText className="size-4" />
            )}
            {entry.document ? copy.regenerate : copy.generate}
          </Button>
          {displayed && !viewingCandidate && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(!editing)}
              >
                {editing ? copy.preview : copy.edit}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !entry.dirty}
                onClick={() => void save()}
                data-testid="course-document-save"
              >
                <Save className="size-4" />
                {copy.save}
              </Button>
            </>
          )}
          {entry.document?.previous && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void actions.restore(key);
              }}
            >
              {copy.restore}
            </Button>
          )}
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {entry.dirty ? copy.unsaved : entry.document ? copy.saved : ''}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !entry.document || entry.dirty || viewingCandidate}
            title={entry.dirty ? copy.exportHint : undefined}
            onClick={() => void exportDocument('word')}
          >
            <Download className="size-4" />
            {copy.word}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !entry.document || entry.dirty || viewingCandidate}
            title={entry.dirty ? copy.exportHint : undefined}
            onClick={() => void exportDocument('pdf')}
          >
            <Printer className="size-4" />
            {copy.pdf}
          </Button>
        </div>
        {!ready && <p className="text-xs text-amber-700 dark:text-amber-300">{copy.notReady}</p>}
        {entry.status !== 'idle' && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {entry.status === 'loading'
              ? copy.loading
              : entry.status === 'saving'
                ? copy.saving
                : copy.generating}
            {entry.progress && `${entry.progress.current} / ${entry.progress.total}`}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-3 sm:p-5">
          {!displayed && (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center text-muted-foreground">
              <BookOpenText className="size-10 opacity-40" />
              <p>{kind === 'teacher-plan' ? copy.emptyTeacher : copy.emptyStudent}</p>
            </div>
          )}
          {editing && displayed && !viewingCandidate && (
            <fieldset disabled={busy} className="space-y-5" data-testid="course-document-editor">
              <label className="block space-y-1 text-sm font-medium">
                {copy.titleLabel}
                <input
                  aria-label={copy.titleLabel}
                  value={displayed.title}
                  maxLength={400}
                  onChange={(e) => edit({ ...displayed, title: e.target.value })}
                  className="w-full rounded-md border bg-background p-2"
                />
              </label>
              <p className="text-xs text-muted-foreground">{copy.syntax}</p>
              {displayed.sections.map((section, index) => (
                <section key={section.id} className="space-y-2 rounded-lg border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`${copy.sectionTitle} ${index + 1}`}
                      value={section.title}
                      maxLength={300}
                      onChange={(e) =>
                        edit({
                          ...displayed,
                          sections: displayed.sections.map((s, i) =>
                            i === index ? { ...s, title: e.target.value } : s,
                          ),
                        })
                      }
                      className="min-w-0 flex-1 rounded border bg-background p-2 font-medium"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${copy.removeSection} ${index + 1}`}
                      disabled={displayed.sections.length === 1}
                      onClick={() =>
                        edit({
                          ...displayed,
                          sections: displayed.sections.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <textarea
                    aria-label={`${copy.sectionContent} ${index + 1}`}
                    value={section.content}
                    maxLength={100_000}
                    rows={Math.max(5, Math.min(16, section.content.split('\n').length + 1))}
                    onChange={(e) =>
                      edit({
                        ...displayed,
                        sections: displayed.sections.map((s, i) =>
                          i === index ? { ...s, content: e.target.value } : s,
                        ),
                      })
                    }
                    className="w-full resize-y rounded border bg-background p-3 text-sm leading-7"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        edit({
                          ...displayed,
                          sections: displayed.sections.map((s, i) =>
                            i === index ? { ...s, content: `${s.content}\n\n` } : s,
                          ),
                        })
                      }
                    >
                      <Plus className="size-3" />
                      {copy.addParagraph}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {sectionSources(section.sourceSceneIds)}
                    </span>
                  </div>
                </section>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  edit({
                    ...displayed,
                    sections: [
                      ...displayed.sections,
                      {
                        id: crypto.randomUUID(),
                        title: copy.newSection,
                        content: '',
                        sourceSceneIds: [],
                      },
                    ],
                  })
                }
              >
                <Plus className="size-4" />
                {copy.addSection}
              </Button>
            </fieldset>
          )}
          {displayed && !editing && reviewWarnings.length > 0 && (
            <details className="mx-auto mb-3 max-w-[800px] rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-900">
              <summary className="cursor-pointer font-medium">
                {copy.warnings}（{reviewWarnings.length}）
              </summary>
              <ul className="mt-2 list-disc pl-5">
                {reviewWarnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <div hidden={editing && !viewingCandidate}>
            {displayed && (
              <article
                ref={previewRef}
                className="mx-auto max-w-[800px] rounded bg-white p-5 text-slate-900 shadow-sm sm:p-9"
                data-testid="course-document-preview"
              >
                <h1 className="mb-2 text-2xl font-bold text-[#2f5b48]">{displayed.title}</h1>
                <p className="mb-6 text-xs text-slate-500">
                  {stage?.name} · {kind === 'teacher-plan' ? copy.teacher : copy.student}
                </p>
                {displayed.sections.map((section) => (
                  <section key={section.id} className="mb-7">
                    <h2 className="mb-2 border-b border-[#2f5b48]/15 pb-1 text-lg font-semibold text-[#2f5b48]">
                      {section.title}
                    </h2>
                    <div className="prose prose-sm max-w-none break-words text-slate-800 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
                      <Streamdown
                        mode="static"
                        skipHtml
                        plugins={plugins}
                        remarkPlugins={remarkPlugins}
                        controls={false}
                      >
                        {section.content}
                      </Streamdown>
                    </div>
                    {section.sourceSceneIds.length > 0 && (
                      <p className="course-document-sources mt-2 text-[11px] text-slate-500">
                        {copy.sources}：{sectionSources(section.sourceSceneIds)}
                      </p>
                    )}
                  </section>
                ))}
              </article>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
