'use client';

import { useState } from 'react';
import { BookOpenCheck, CheckCircle2 } from 'lucide-react';
import type { SchoolCourseProfile } from '@openmaic/dsl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { normalizeSchoolCourseProfile } from '@/lib/generation/school-course-profile';

interface SchoolCourseSettingsProps {
  value: SchoolCourseProfile;
  onChange: (value: SchoolCourseProfile) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}

const fieldClass = 'space-y-1.5';
const labelClass = 'text-xs font-medium text-foreground/80';
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus:ring-2 focus:ring-ring/40';

export function SchoolCourseSettings({
  value,
  onChange,
  open,
  onOpenChange,
  disabled,
}: SchoolCourseSettingsProps) {
  const [draft, setDraft] = useState(() => normalizeSchoolCourseProfile(value));

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setDraft(normalizeSchoolCourseProfile(value));
    onOpenChange(nextOpen);
  };

  const update = <K extends keyof SchoolCourseProfile>(key: K, next: SchoolCourseProfile[K]) => {
    setDraft((current) => ({ ...current, [key]: next, teacherReviewed: false }));
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => handleOpenChange(true)}
        aria-pressed={value.enabled}
        data-testid="school-course-settings"
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50',
          value.enabled
            ? 'border-emerald-400/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground',
        )}
      >
        {value.enabled ? (
          <CheckCircle2 className="size-3.5" />
        ) : (
          <BookOpenCheck className="size-3.5" />
        )}
        学校课件
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>学校标准课件设置</DialogTitle>
            <DialogDescription>
              这些信息会写入课程、生成约束和离线交付包。AI可协助生成，但最终内容仍需任课教师审核。
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
            <div>
              <div className="text-sm font-medium">启用学校标准课件</div>
              <div className="text-xs text-muted-foreground">
                启用后，缺少必要教学信息时将暂停生成。
              </div>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) => update('enabled', checked)}
              aria-label="启用学校标准课件"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <label className={fieldClass}>
              <span className={labelClass}>学段</span>
              <select
                className={selectClass}
                value={draft.educationStage}
                onChange={(event) =>
                  update(
                    'educationStage',
                    event.target.value as SchoolCourseProfile['educationStage'],
                  )
                }
              >
                <option value="primary">小学</option>
                <option value="junior">初中</option>
                <option value="senior">高中</option>
                <option value="vocational">职业教育</option>
                <option value="higher">高等教育</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>年级 *</span>
              <Input
                value={draft.grade}
                onChange={(event) => update('grade', event.target.value)}
                placeholder="例如：高一"
              />
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>学科 *</span>
              <Input
                value={draft.subject}
                onChange={(event) => update('subject', event.target.value)}
                placeholder="例如：化学"
              />
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>计划课时（分钟）</span>
              <Input
                type="number"
                min={10}
                max={180}
                value={draft.durationMinutes}
                onChange={(event) => update('durationMinutes', Number(event.target.value))}
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className={fieldClass}>
              <span className={labelClass}>教材版本</span>
              <Input
                value={draft.textbookVersion}
                onChange={(event) => update('textbookVersion', event.target.value)}
                placeholder="例如：人教版"
              />
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>册次</span>
              <Input
                value={draft.volume}
                onChange={(event) => update('volume', event.target.value)}
                placeholder="例如：必修第一册"
              />
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>单元 / 课题</span>
              <Input
                value={draft.unit}
                onChange={(event) => update('unit', event.target.value)}
                placeholder="例如：第二章 氯及其化合物"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className={fieldClass}>
              <span className={labelClass}>课型</span>
              <select
                className={selectClass}
                value={draft.lessonType}
                onChange={(event) =>
                  update('lessonType', event.target.value as SchoolCourseProfile['lessonType'])
                }
              >
                <option value="new">新授课</option>
                <option value="review">复习课</option>
                <option value="experiment">实验课</option>
                <option value="practice">习题课</option>
                <option value="project">项目课</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>评价方式</span>
              <select
                className={selectClass}
                value={draft.assessmentMode}
                onChange={(event) =>
                  update(
                    'assessmentMode',
                    event.target.value as SchoolCourseProfile['assessmentMode'],
                  )
                }
              >
                <option value="none">教师现场判断</option>
                <option value="teacher-check">教师提问与观察</option>
                <option value="formative">形成性评价</option>
                <option value="quiz">课内测验</option>
              </select>
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>互动场景上限</span>
              <Input
                type="number"
                min={0}
                max={6}
                value={draft.interactionBudget}
                onChange={(event) => update('interactionBudget', Number(event.target.value))}
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className={fieldClass}>
              <span className={labelClass}>学习目标 *</span>
              <Textarea
                value={draft.learningObjectives}
                onChange={(event) => update('learningObjectives', event.target.value)}
                placeholder="建议使用可观察、可评价的行为表述，例如：能够解释……并完成……"
                className="min-h-24"
              />
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>学情分析</span>
              <Textarea
                value={draft.learnerProfile}
                onChange={(event) => update('learnerProfile', event.target.value)}
                placeholder="已有知识、常见错误、班级特点"
                className="min-h-24"
              />
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>教学重点 *</span>
              <Textarea
                value={draft.keyPoints}
                onChange={(event) => update('keyPoints', event.target.value)}
                className="min-h-20"
              />
            </label>
            <label className={fieldClass}>
              <span className={labelClass}>教学难点 *</span>
              <Textarea
                value={draft.difficultPoints}
                onChange={(event) => update('difficultPoints', event.target.value)}
                className="min-h-20"
              />
            </label>
          </div>

          <label className={fieldClass}>
            <span className={labelClass}>课程标准、教材或资料来源</span>
            <Textarea
              value={draft.sourceReferences}
              onChange={(event) => update('sourceReferences', event.target.value)}
              placeholder="例如：普通高中化学课程标准（2017年版2020年修订）、人教版教材对应章节"
              className="min-h-20"
            />
          </label>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                onChange(normalizeSchoolCourseProfile(draft));
                onOpenChange(false);
              }}
            >
              保存设置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
