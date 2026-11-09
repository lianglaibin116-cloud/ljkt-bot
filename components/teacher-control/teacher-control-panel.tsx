'use client';

import { ChevronLeft, ChevronRight, Play, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import { auditSchoolCourse } from '@/lib/course-quality/audit';
import { dispatchTeacherControl } from '@/lib/teacher-control/events';

interface TeacherControlPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeacherControlPanel({ open, onOpenChange }: TeacherControlPanelProps) {
  const stage = useStageStore((state) => state.stage);
  const scenes = useStageStore((state) => state.scenes);
  const outlines = useStageStore((state) => state.outlines);
  const currentSceneId = useStageStore((state) => state.currentSceneId);
  const autoPlayLecture = useSettingsStore((state) => state.autoPlayLecture);
  const setAutoPlayLecture = useSettingsStore((state) => state.setAutoPlayLecture);
  const currentIndex = scenes.findIndex((scene) => scene.id === currentSceneId);
  const currentScene = currentIndex >= 0 ? scenes[currentIndex] : undefined;
  const nextScene = currentIndex >= 0 ? scenes[currentIndex + 1] : scenes[0];
  const report = auditSchoolCourse(stage, scenes, outlines);
  const targetMinutes = stage?.schoolCourseProfile?.durationMinutes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Presentation className="size-5 text-violet-600" />
            教师授课控制台
          </DialogTitle>
          <DialogDescription>
            演示时集中控制课件进度、语音自动播放和场景切换。键盘仍可使用方向键与空格键。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="当前页面"
            value={currentIndex >= 0 ? `${currentIndex + 1}/${scenes.length}` : '—'}
          />
          <Metric label="预计授课" value={`${report.stats.estimatedMinutes}分钟`} />
          <Metric label="计划课时" value={targetMinutes ? `${targetMinutes}分钟` : '未设置'} />
        </div>

        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="text-xs text-muted-foreground">正在讲授</div>
          <div className="mt-1 font-medium">{currentScene?.title ?? '请选择一个场景'}</div>
          <div className="mt-3 text-xs text-muted-foreground">下一页</div>
          <div className="mt-1 text-sm">{nextScene?.title ?? '课程结束'}</div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => dispatchTeacherControl('previous-scene')}
            disabled={currentIndex <= 0}
          >
            <ChevronLeft className="size-4" /> 上一页
          </Button>
          <Button type="button" onClick={() => dispatchTeacherControl('toggle-play')}>
            <Play className="size-4" />
            播放 / 暂停
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => dispatchTeacherControl('next-scene')}
            disabled={currentIndex < 0 || currentIndex >= scenes.length - 1}
          >
            下一页 <ChevronRight className="size-4" />
          </Button>
        </div>

        <label className="flex items-center justify-between rounded-xl border px-4 py-3">
          <span>
            <span className="block text-sm font-medium">自动连续讲授</span>
            <span className="block text-xs text-muted-foreground">
              语音结束后自动进入下一段讲解
            </span>
          </span>
          <Switch checked={autoPlayLecture} onCheckedChange={setAutoPlayLecture} />
        </label>

        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2">
          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                scene.id === currentSceneId
                  ? 'bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-100'
                  : ''
              }`}
            >
              <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="truncate">{scene.title}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background px-3 py-2.5 text-center">
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
