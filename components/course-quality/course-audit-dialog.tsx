'use client';

import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStageStore } from '@/lib/store';
import {
  auditSchoolCourse,
  canConfirmTeacherReview,
  type CourseAuditIssue,
} from '@/lib/course-quality/audit';
import { cn } from '@/lib/utils';

interface CourseAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categoryLabels: Record<CourseAuditIssue['category'], string> = {
  metadata: '课程信息',
  teaching: '教学设计',
  assessment: '教学评价',
  timing: '课堂节奏',
  safety: '安全内容',
  language: '教学语言',
  visual: '视觉呈现',
  offline: '离线交付',
};

function IssueIcon({ severity }: { severity: CourseAuditIssue['severity'] }) {
  if (severity === 'blocking') return <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />;
  if (severity === 'warning') {
    return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />;
  }
  return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-500" />;
}

export function CourseAuditDialog({ open, onOpenChange }: CourseAuditDialogProps) {
  const stage = useStageStore((state) => state.stage);
  const scenes = useStageStore((state) => state.scenes);
  const outlines = useStageStore((state) => state.outlines);
  const updateStageMetadata = useStageStore((state) => state.updateStageMetadata);
  const report = auditSchoolCourse(stage, scenes, outlines);

  const markReviewed = () => {
    if (!stage?.schoolCourseProfile || !canConfirmTeacherReview(report)) return;
    updateStageMetadata({
      schoolCourseProfile: { ...stage.schoolCourseProfile, teacherReviewed: true },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" />
            学校课件审核
          </DialogTitle>
          <DialogDescription>
            自动检查课程信息、教学节奏、评价设计、危险表述和离线交付条件。自动审核不能替代任课教师复核。
          </DialogDescription>
        </DialogHeader>

        {report.status === 'not-enabled' ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            本课程没有启用“学校标准课件”。请从主页启用后重新生成，旧课程仍可按原方式使用和导出。
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <AuditMetric label="审核分" value={String(report.score)} />
              <AuditMetric label="总页数" value={String(report.stats.sceneCount)} />
              <AuditMetric label="互动" value={String(report.stats.interactiveCount)} />
              <AuditMetric label="测验" value={String(report.stats.quizCount)} />
              <AuditMetric label="预计时长" value={`${report.stats.estimatedMinutes}分钟`} />
            </div>

            <div
              className={cn(
                'rounded-xl border px-4 py-3 text-sm',
                report.blockingCount > 0
                  ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
                  : report.warningCount > 0
                    ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
              )}
            >
              {report.blockingCount > 0
                ? `${report.blockingCount}项问题会阻止学校课件导出，另有${report.warningCount}项建议。`
                : report.warningCount > 0
                  ? `没有阻断问题，仍有${report.warningCount}项建议需要教师判断。`
                  : '自动检查已通过，并已完成教师审核确认。'}
            </div>

            <div className="space-y-2">
              {report.issues.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <CheckCircle2 className="size-5" /> 所有学校课件检查项均已通过。
                </div>
              ) : (
                report.issues.map((item) => (
                  <div key={item.id} className="flex gap-3 rounded-xl border p-3.5">
                    <IssueIcon severity={item.severity} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.title}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {categoryLabels[item.category]}
                        </span>
                        {item.sceneTitle ? (
                          <span className="text-xs text-muted-foreground">
                            页面：{item.sceneTitle}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {report.status !== 'not-enabled' && !stage?.schoolCourseProfile?.teacherReviewed ? (
            <Button disabled={!canConfirmTeacherReview(report)} onClick={markReviewed}>
              <ShieldCheck className="size-4" />
              教师确认已审核
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2.5 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
