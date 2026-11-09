import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { z } from 'zod';
import { liftInlineMath } from '@/lib/sanitize/inline-math';
import type { Stage, Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';

const questionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.object({ label: z.string(), value: z.string() })),
  answer: z.array(z.string()),
  analysis: z.string(),
  guidance: z.string(),
});
export const courseDocumentSourceSchema = z.object({
  stageId: z.string().min(1).max(200),
  name: z.string().min(1).max(1000),
  description: z.string(),
  language: z.string().max(2000),
  profile: z.record(z.string(), z.union([z.string(), z.number()])),
  pages: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        order: z.number(),
        title: z.string(),
        type: z.enum(['slide', 'quiz', 'interactive', 'pbl']),
        text: z.string(),
        objective: z.string(),
        questions: z.array(questionSchema),
      }),
    )
    .min(1)
    .max(500),
  warnings: z.array(z.string()),
});
export type CourseDocumentSource = z.infer<typeof courseDocumentSourceSchema>;
export type CourseSourcePage = CourseDocumentSource['pages'][number];

type HtmlNode = DefaultTreeAdapterMap['node'];
const OMIT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object']);
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'main',
  'article',
  'li',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'br',
  'pre',
]);

/** Parse inertly on both server and client. Inline formula source wins over rendered glyphs. */
export function educationalHtmlText(html: string): string {
  const walk = (node: HtmlNode): string => {
    if ('value' in node) return String(node.value);
    if ('tagName' in node) {
      if (OMIT_TAGS.has(node.tagName)) return '';
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      const math = attrs['data-latex'] || attrs['data-math-latex'] || attrs['data-inline-math'];
      if (math && math !== 'true') return ` $${math}$ `;
      if (node.tagName === 'annotation' && attrs.encoding?.includes('tex')) {
        return ` $${node.childNodes.map(walk).join('')}$ `;
      }
      if (node.tagName === 'img') return attrs.alt ? ` [图：${attrs.alt}] ` : '';
      const text = node.childNodes.map(walk).join('');
      return BLOCK_TAGS.has(node.tagName) ? `\n${text}\n` : text;
    }
    return 'childNodes' in node ? node.childNodes.map(walk).join('') : '';
  };
  return walk(parseFragment(liftInlineMath(html) ?? html))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? educationalHtmlText(value) : '';
}
function literalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const PBL_FIELDS = new Set([
  'title',
  'name',
  'description',
  'topic',
  'background',
  'objective',
  'objectives',
  'learningObjectives',
  'learningObjective',
  'gains',
  'hints',
  'briefing',
  'debrief',
  'successWhen',
  'skillFocus',
  'narration',
  'learnerBrief',
  'synthesisCheck',
  'coreConcept',
  'setting',
  'rules',
  'learnerRole',
  'characters',
  'situation',
  'targetSkills',
  'knowledgePoints',
  'keyPoints',
  'instructions',
  'goal',
  'goals',
  'task',
  'tasks',
  'milestones',
  'microtasks',
  'threads',
  'roles',
  'successCriteria',
  'criteria',
  'requirements',
  'deliverables',
  'expectedOutcome',
  'content',
  'documents',
  'brief',
  'scenario',
  'scenarioBrief',
  'concepts',
  'rubric',
  'acceptanceCriteria',
  'acceptanceChecks',
  'completionCriteria',
  'teachingNotes',
]);

function pblText(value: unknown): string {
  if (typeof value === 'string') return literalText(value);
  if (Array.isArray(value)) return value.map(pblText).filter(Boolean).join('\n');
  return Object.entries(record(value))
    .filter(([key]) => PBL_FIELDS.has(key))
    .map(([, child]) => pblText(child))
    .filter(Boolean)
    .join('\n');
}

function canvasText(canvas: unknown): string {
  const elements = record(canvas).elements;
  if (!Array.isArray(elements)) return '';
  return elements
    .map((raw) => {
      const element = record(raw);
      switch (element.type) {
        case 'text':
          return text(element.content);
        case 'shape':
          return text(record(element.text).content);
        case 'latex':
          return typeof element.latex === 'string' ? `$$${element.latex}$$` : '';
        case 'code':
          return `\`\`\`${String(element.language || '')}\n${Array.isArray(element.lines) ? element.lines.map((line) => String(record(line).content ?? record(line).text ?? '')).join('\n') : ''}\n\`\`\``;
        case 'table':
          return Array.isArray(element.data)
            ? element.data
                .map((row) =>
                  Array.isArray(row)
                    ? row.map((cell) => text(record(cell).text ?? record(cell).content)).join(' | ')
                    : '',
                )
                .join('\n')
            : '';
        case 'chart':
          return `图表数据：${JSON.stringify(element.data ?? {})}`;
        case 'image':
          return text(element.alt ?? element.description ?? element.title);
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

/** Only teaching semantics enter the fingerprint, never coordinates, colors or runtime answers. */
export function extractCourseDocumentSource(
  stage: Stage,
  scenes: readonly Scene[],
  outlines: readonly SceneOutline[] = [],
): CourseDocumentSource {
  const warnings: string[] = [];
  const profile: Record<string, string | number> = {};
  if (stage.schoolCourseProfile?.enabled) {
    for (const key of [
      'educationStage',
      'grade',
      'subject',
      'textbookVersion',
      'volume',
      'unit',
      'lessonType',
      'durationMinutes',
      'learningObjectives',
      'keyPoints',
      'difficultPoints',
      'learnerProfile',
    ] as const) {
      const value = stage.schoolCourseProfile[key];
      if (value !== '' && value !== undefined) profile[key] = value;
    }
  }
  const pages = [...scenes]
    .sort((a, b) => a.order - b.order)
    .map((scene): CourseSourcePage => {
      const outline = scene.outlineId
        ? outlines.find((o) => o.id === scene.outlineId)
        : outlines.find((o) => o.order === scene.order && o.title === scene.title);
      const content = record(scene.content);
      const parts: string[] = [];
      if (scene.type === 'slide') parts.push(canvasText(content.canvas));
      if (scene.type === 'interactive') {
        parts.push(text(content.html), pblText(content.widgetConfig));
        if (!content.html && content.url)
          warnings.push(`第${scene.order}页仅有外部互动链接，请补充其操作现象和结论。`);
      }
      if (scene.type === 'pbl') parts.push(pblText(content.projectV2 ?? content.projectConfig));
      for (const whiteboard of scene.whiteboards ?? []) parts.push(canvasText(whiteboard));
      for (const action of scene.actions ?? []) {
        if (action.type === 'speech') parts.push(literalText(action.text));
        if (action.type === 'wb_draw_text') parts.push(text(action.content));
        if (action.type === 'wb_draw_latex') parts.push(`$$${action.latex}$$`);
        if (action.type === 'wb_draw_chart')
          parts.push(`白板图表数据：${JSON.stringify(action.data)}`);
        if (action.type === 'wb_draw_table')
          parts.push(action.data.map((row) => row.map(literalText).join(' | ')).join('\n'));
        if (action.type === 'wb_draw_code')
          parts.push(`\`\`\`${action.language}\n${action.code}\n\`\`\``);
      }
      const questions: CourseSourcePage['questions'] =
        scene.type === 'quiz' && Array.isArray(content.questions)
          ? content.questions.map((raw, i) => {
              const q = record(raw);
              return {
                id: typeof q.id === 'string' ? q.id : `${scene.id}-q${i + 1}`,
                question: literalText(q.question),
                options: Array.isArray(q.options)
                  ? q.options.map((o) => ({
                      label: literalText(record(o).label),
                      value: String(record(o).value ?? ''),
                    }))
                  : [],
                answer: Array.isArray(q.answer) ? q.answer.map(String) : [],
                analysis: literalText(q.analysis),
                guidance: literalText(q.commentPrompt),
              };
            })
          : [];
      const actualText = [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(
        '\n\n',
      );
      if (!actualText && questions.length === 0)
        warnings.push(`第${scene.order}页“${scene.title}”缺少可读教学内容，请核对。`);
      return {
        id: scene.id,
        order: scene.order,
        title: scene.title,
        type: scene.type,
        text: actualText,
        objective: [outline?.teachingObjective, outline?.description, ...(outline?.keyPoints ?? [])]
          .filter(Boolean)
          .join('\n'),
        questions,
      };
    });
  return courseDocumentSourceSchema.parse({
    stageId: stage.id,
    name: stage.name,
    description: stage.description ?? '',
    language: stage.languageDirective ?? '',
    profile,
    pages,
    warnings,
  });
}

export async function fingerprintCourseSource(source: CourseDocumentSource): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(courseDocumentSourceSchema.parse(source)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function courseDocumentsReady(state: {
  scenes: readonly unknown[];
  generatingOutlines: readonly unknown[];
  failedOutlines: readonly unknown[];
  generationStatus: string;
}): boolean {
  return (
    state.scenes.length > 0 &&
    state.generatingOutlines.length === 0 &&
    state.failedOutlines.length === 0 &&
    !['generating', 'paused', 'error'].includes(state.generationStatus)
  );
}
