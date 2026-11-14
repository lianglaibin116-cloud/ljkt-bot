'use client';

import { useEffect, useState } from 'react';
import { Check, Code2, Move, RefreshCw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toRuntimeSlideContent } from '@/lib/agent/client/apply-regenerate';
import { mayGenerateForStage, useMayGenerateForStage } from '@/lib/classroom/generation-permission';
import { fetchSceneContent } from '@/lib/hooks/use-scene-generator';
import { validateGeneratedInteractiveHtml } from '@/lib/interactive/validate-generated-html';
import { commitCourseEdit } from '@/lib/edit/course-edit';
import { useCanvasStore } from '@/lib/store/canvas';
import { useStageStore } from '@/lib/store/stage';
import {
  countInteractiveLayoutChanges,
  readInteractiveLayoutOverrides,
  writeInteractiveLayoutOverrides,
} from '@/lib/interactive/layout-overrides';
import { useInteractiveLayoutEditor } from '@/lib/store/interactive-layout-editor';
import type {
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';
import type { InteractiveContent, Scene, SceneContent, SlideContent } from '@/lib/types/stage';

type EditMode = 'request' | 'html';
type EditableScene = Extract<Scene, { type: 'slide' | 'quiz' | 'interactive' }>;

/** Regenerates the current slide, quiz, or interactive page while retaining narration. */
export function ScenePageEditor({ scene }: { readonly scene: EditableScene }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EditMode>('request');
  const [request, setRequest] = useState('');
  const [html, setHtml] = useState('');
  const [baseContent, setBaseContent] = useState<SceneContent>(scene.content);
  const [removeOldActions, setRemoveOldActions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canGenerate = useMayGenerateForStage(scene.stageId);
  const sourceHtml = scene.content.type === 'interactive' ? (scene.content.html ?? '') : '';
  const layoutSceneId = useInteractiveLayoutEditor((state) => state.sceneId);
  const layoutInitial = useInteractiveLayoutEditor((state) => state.initial);
  const layoutOverrides = useInteractiveLayoutEditor((state) => state.overrides);
  const layoutEditing = scene.type === 'interactive' && layoutSceneId === scene.id;
  const layoutChangeCount = layoutEditing
    ? countInteractiveLayoutChanges(layoutInitial, layoutOverrides)
    : 0;

  useEffect(() => () => useInteractiveLayoutEditor.getState().cancel(scene.id), [scene.id]);

  function openEditor() {
    setBaseContent(scene.content);
    setHtml(sourceHtml);
    setRequest('');
    setMode('request');
    setRemoveOldActions(true);
    setError(null);
    setOpen(true);
  }

  function startLayoutEditing() {
    if (scene.type !== 'interactive' || !sourceHtml) return;
    useInteractiveLayoutEditor
      .getState()
      .start(scene.id, readInteractiveLayoutOverrides(sourceHtml));
  }

  function cancelLayoutEditing() {
    useInteractiveLayoutEditor.getState().cancel(scene.id);
  }

  function saveLayoutEditing() {
    const draft = useInteractiveLayoutEditor.getState();
    if (scene.type !== 'interactive' || draft.sceneId !== scene.id) return;
    const changes = countInteractiveLayoutChanges(draft.initial, draft.overrides);
    if (changes === 0) {
      draft.cancel(scene.id);
      toast.info('没有需要保存的位置调整。');
      return;
    }

    const state = useStageStore.getState();
    const latest = state.scenes.find((item) => item.id === scene.id);
    if (latest?.type !== 'interactive' || latest.content.html !== sourceHtml) {
      draft.cancel(scene.id);
      toast.error('页面内容已发生变化，请重新进入布局编辑。');
      return;
    }

    const html = writeInteractiveLayoutOverrides(sourceHtml, draft.overrides);
    draft.finish(scene.id);
    commitCourseEdit({}, () =>
      state.updateScene(scene.id, { content: { ...latest.content, html } }),
    );
    toast.success(`已保存 ${changes} 处布局调整。`);
  }

  function applyContent(
    content: SceneContent,
    expectedContent: SceneContent,
    outlineId = scene.outlineId,
  ) {
    const state = useStageStore.getState();
    const latest = state.scenes.find((item) => item.id === scene.id);
    if (!latest || latest.type !== scene.type || latest.content !== expectedContent) {
      throw new Error('页面已在其他位置更新。请重新打开编辑窗口后再试。');
    }
    const actions = latest.actions ?? [];
    const retainedActions =
      scene.type === 'interactive'
        ? actions.filter((action) => !action.type.startsWith('widget_'))
        : actions.filter((action) => action.type === 'speech');
    const metadataPatch = {
      ...(outlineId ? { outlineId } : {}),
      ...(removeOldActions ? { actions: retainedActions } : {}),
    };
    commitCourseEdit({}, () => state.updateScene(scene.id, { content, ...metadataPatch }));
    if (scene.type === 'slide') useCanvasStore.getState().clearSelection();
    setOpen(false);
    toast.success('页面已更新，请检查讲解和动作时间轴。');
  }

  async function submit() {
    if (busy) return;
    const originalContent = baseContent;
    setError(null);
    setBusy(true);
    try {
      if (mode === 'html') {
        if (scene.type !== 'interactive') throw new Error('只有交互页面支持直接编辑 HTML。');
        if (!/<html(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html)) {
          throw new Error('请输入包含 html 和 body 的完整 HTML 页面。');
        }
        if (html.length > 120_000) throw new Error('HTML 不能超过 120,000 个字符。');
        const validation = await validateGeneratedInteractiveHtml(html);
        if (validation.errors.length) {
          throw new Error(`页面运行检查未通过：${validation.errors.join('；')}`);
        }
        applyContent({ ...(originalContent as InteractiveContent), html }, originalContent);
        if (validation.warnings.length > 0) {
          toast.warning(t('chat.interactiveRuntimeError.externalCheckSkipped'));
        }
        return;
      }

      const instruction = request.trim();
      if (!instruction) throw new Error('请写明希望删除或修改的内容。');
      if (!mayGenerateForStage(scene.stageId)) {
        throw new Error('当前课程没有生成权限，无法重新生成此页面。');
      }
      const state = useStageStore.getState();
      const stage = state.stage;
      if (!stage || stage.id !== scene.stageId) throw new Error('课程已切换，请重新打开编辑窗口。');
      const existing = state.outlines.find((item) => item.id === scene.outlineId);
      const baseOutline: SceneOutline = existing ?? {
        id: scene.outlineId ?? scene.id,
        type: scene.type,
        title: scene.title,
        description: scene.title,
        keyPoints: [scene.title],
        order: scene.order,
      };
      const cleanDescription = baseOutline.description.split(/\n\n本次修改要求/u, 1)[0];
      const revisedOutline: SceneOutline = {
        ...baseOutline,
        type: scene.type,
        title: scene.title,
        order: scene.order,
        description:
          scene.type === 'slide'
            ? cleanDescription
            : `${cleanDescription}\n\n本次修改要求（优先于原设计）：${instruction}\n保留原页面的教学目标，只保留目标所需的内容与功能。`,
      };
      const allOutlines = state.outlines.some((item) => item.id === revisedOutline.id)
        ? state.outlines.map((item) => (item.id === revisedOutline.id ? revisedOutline : item))
        : [...state.outlines, revisedOutline];
      const result = await fetchSceneContent(
        {
          outline: revisedOutline,
          allOutlines,
          stageId: stage.id,
          stageInfo: { name: stage.name, description: stage.description },
          requirements: {
            requirement: `只重新制作当前页面。修改要求：${instruction}。保留原页面的教学目标和核心知识点，不要加入与教学目标无关的额外内容或功能。`,
            ...(scene.type === 'interactive' ? { interactiveMode: true } : {}),
          },
          ...(scene.type === 'slide'
            ? {
                editDirective: instruction,
                baselineContent: {
                  elements: (originalContent as SlideContent).canvas.elements,
                  ...((originalContent as SlideContent).canvas.background !== undefined
                    ? { background: (originalContent as SlideContent).canvas.background }
                    : {}),
                },
              }
            : {}),
        },
        undefined,
        { maxRetries: 0 },
      );
      if (!result.success || !result.content) {
        throw new Error(result.error || '重新生成失败，请检查模型设置后重试。');
      }

      const generated = result.content as {
        elements?: unknown;
        questions?: unknown;
        html?: unknown;
        widgetType?: unknown;
        widgetConfig?: unknown;
      };
      let content: SceneContent;
      if (scene.type === 'slide') {
        if (!Array.isArray(generated.elements) || generated.elements.length === 0) {
          throw new Error('生成结果没有可用的幻灯片内容。');
        }
        const slide = originalContent as Extract<SceneContent, { type: 'slide' }>;
        content = toRuntimeSlideContent(
          generated as unknown as GeneratedSlideContent,
          slide.canvas as unknown as Record<string, unknown>,
        );
      } else if (scene.type === 'quiz') {
        if (!Array.isArray(generated.questions) || generated.questions.length === 0) {
          throw new Error('生成结果没有可用的测验题目。');
        }
        content = {
          type: 'quiz',
          questions: (generated as unknown as GeneratedQuizContent).questions,
        };
      } else {
        if (typeof generated.html !== 'string' || !generated.html.trim()) {
          throw new Error('生成结果不是可编辑的交互页面。');
        }
        const validation = await validateGeneratedInteractiveHtml(generated.html);
        if (validation.errors.length) {
          throw new Error(`页面运行检查未通过：${validation.errors.join('；')}`);
        }
        if (validation.warnings.length > 0) {
          toast.warning(t('chat.interactiveRuntimeError.externalCheckSkipped'));
        }
        const originalInteractive = originalContent as InteractiveContent;
        content = {
          type: 'interactive',
          ...(originalInteractive.url !== undefined ? { url: originalInteractive.url } : {}),
          html: generated.html,
          ...(typeof generated.widgetType === 'string'
            ? { widgetType: generated.widgetType as InteractiveContent['widgetType'] }
            : {}),
          ...(generated.widgetConfig && typeof generated.widgetConfig === 'object'
            ? { widgetConfig: generated.widgetConfig as InteractiveContent['widgetConfig'] }
            : {}),
        };
      }
      applyContent(content, originalContent, revisedOutline.id);
      const latest = useStageStore.getState();
      if (latest.stage?.id === stage.id) {
        latest.setOutlines(
          latest.outlines.some((item) => item.id === revisedOutline.id)
            ? latest.outlines.map((item) => (item.id === revisedOutline.id ? revisedOutline : item))
            : [...latest.outlines, revisedOutline],
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  const pageKind =
    scene.type === 'interactive' ? '交互页面' : scene.type === 'quiz' ? '测验页' : '幻灯片';

  return (
    <>
      {scene.type === 'interactive' && sourceHtml && (
        <div className="flex items-center gap-1.5">
          {layoutEditing ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={cancelLayoutEditing}
                aria-label="取消布局编辑"
              >
                <X className="mr-1 size-4" />
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={saveLayoutEditing}
                disabled={layoutChangeCount === 0}
                className="gap-1.5"
              >
                <Check className="size-4" />
                保存布局{layoutChangeCount > 0 ? ` (${layoutChangeCount})` : ''}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={startLayoutEditing}
              className="gap-1.5"
            >
              <Move className="size-4" />
              拖拽布局
            </Button>
          )}
        </div>
      )}
      <Button type="button" size="sm" variant="outline" onClick={openEditor} className="gap-1.5">
        <Sparkles className="size-4" />
        修改 / 重新生成
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-3xl gap-4">
          <DialogHeader>
            <DialogTitle>
              编辑{pageKind} · {scene.title}
            </DialogTitle>
            <DialogDescription>
              写清楚希望修改的内容后重新生成当前页。交互页面还可以直接编辑 HTML。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'request' ? 'default' : 'outline'}
              onClick={() => setMode('request')}
              disabled={busy}
            >
              <RefreshCw className="mr-1 size-4" />
              按要求重新生成
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'html' ? 'default' : 'outline'}
              onClick={() => setMode('html')}
              disabled={busy || scene.type !== 'interactive' || !sourceHtml}
            >
              <Code2 className="mr-1 size-4" />
              修改 HTML
            </Button>
          </div>
          {mode === 'request' ? (
            <Textarea
              aria-label="页面修改要求"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="例如：删掉重复说明，突出核心结论；保留讲解目标，减少不必要的元素。"
              className="min-h-32 resize-y"
              disabled={busy || !canGenerate}
            />
          ) : (
            <Textarea
              aria-label="交互页面 HTML"
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              className="min-h-72 max-h-[50vh] resize-y font-mono text-xs"
              spellCheck={false}
              disabled={busy}
            />
          )}
          {!canGenerate && mode === 'request' && (
            <p className="text-sm text-amber-600">
              当前课程无法从此浏览器重新生成；交互页面仍可直接修改 HTML。
            </p>
          )}
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={removeOldActions}
              onChange={(event) => setRemoveOldActions(event.target.checked)}
              disabled={busy}
              className="mt-0.5"
            />
            移除旧页面动作，保留讲解文本。页面内容改变后，请检查讲解是否仍然对应。
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={
                busy || (mode === 'request' ? !request.trim() || !canGenerate : !html.trim())
              }
            >
              {busy ? '处理中…' : mode === 'request' ? '重新生成当前页' : '保存 HTML'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
