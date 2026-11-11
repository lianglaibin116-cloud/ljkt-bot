import type { CourseDocumentSource } from '@/lib/course-documents/source';
import type { BotMaterial } from './contracts';

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/u;

/** Conservative estimate suitable for budgeting mixed Chinese/English prompts. */
export function estimateTextTokens(value: string): number {
  let estimate = 0;
  let asciiRun = 0;
  const flushAscii = () => {
    if (asciiRun) estimate += asciiRun / 3.5;
    asciiRun = 0;
  };
  for (const character of value) {
    if (CJK.test(character)) {
      flushAscii();
      estimate += 1.35;
    } else if (/\s/u.test(character)) {
      flushAscii();
      estimate += 0.15;
    } else if (/^[\x00-\x7f]$/u.test(character)) {
      asciiRun += 1;
    } else {
      flushAscii();
      estimate += 0.8;
    }
  }
  flushAscii();
  return Math.ceil(estimate);
}

export function takeWithinTokenBudget(
  value: string,
  tokenBudget: number,
): { text: string; truncated: boolean } {
  if (!value || tokenBudget <= 0) return { text: '', truncated: Boolean(value) };
  if (estimateTextTokens(value) <= tokenBudget) return { text: value, truncated: false };
  let result = '';
  let estimate = 0;
  for (const character of value) {
    const cost = CJK.test(character)
      ? 1.35
      : /\s/u.test(character)
        ? 0.15
        : /^[\x00-\x7f]$/u.test(character)
          ? 1 / 3.5
          : 0.8;
    if (estimate + cost > tokenBudget) break;
    result += character;
    estimate += cost;
  }
  const boundary = Math.max(
    result.lastIndexOf('。'),
    result.lastIndexOf('；'),
    result.lastIndexOf('\n'),
    result.lastIndexOf('. '),
  );
  if (boundary > result.length * 0.65) result = result.slice(0, boundary + 1);
  return { text: `${result.trim()}\n[内容因本轮上下文预算而截取]`, truncated: true };
}

export interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function selectRecentMessages(
  messages: ContextMessage[],
  tokenBudget: number,
): { messages: ContextMessage[]; omittedCount: number; tooLongLatest: boolean } {
  const result: ContextMessage[] = [];
  let used = 0;
  const startIndex = Math.max(0, messages.length - 59);
  for (let index = messages.length - 1; index >= startIndex; index--) {
    const message = messages[index];
    const cost = estimateTextTokens(message.content);
    if (result.length === 0 && cost > tokenBudget)
      return { messages: [], omittedCount: messages.length, tooLongLatest: true };
    if (used + cost > tokenBudget) break;
    result.unshift(message);
    used += cost;
  }
  return {
    messages: result,
    omittedCount: Math.max(0, messages.length - result.length),
    tooLongLatest: false,
  };
}

function keywords(value: string): string[] {
  const terms = new Set(value.toLowerCase().match(/[a-z0-9_+#.-]{2,}/g) ?? []);
  const chinese = value.match(/[\u3400-\u9fff]{2,}/gu) ?? [];
  for (const run of chinese) {
    terms.add(run);
    for (let index = 0; index < run.length - 1; index++) terms.add(run.slice(index, index + 2));
  }
  return Array.from(terms).filter(
    (term) => !['什么', '这个', '那个', '怎么', '可以', '需要', '一下'].includes(term),
  );
}

export function buildCourseContext(
  source: CourseDocumentSource,
  prompt: string,
  tokenBudget: number,
): string {
  const terms = keywords(prompt);
  const ranked = source.pages
    .map((page, index) => {
      const haystack =
        `${page.title}\n${page.objective}\n${page.text}\n${page.questions.map((question) => question.question).join(' ')}`.toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (haystack.includes(term) ? Math.min(term.length, 5) : 0),
        0,
      );
      return { page, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const header = [
    `课程：${source.name}`,
    source.description ? `课程说明：${source.description}` : '',
    Object.keys(source.profile).length ? `课程信息：${JSON.stringify(source.profile)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const boundedHeader = takeWithinTokenBudget(
    header,
    Math.max(80, Math.floor(tokenBudget * 0.22)),
  ).text;
  let remaining = Math.max(0, tokenBudget - estimateTextTokens(boundedHeader) - 80);
  const included: string[] = [];
  let omitted = 0;
  for (const { page } of ranked) {
    if (remaining <= 40) {
      omitted++;
      continue;
    }
    const detail = [
      `第 ${page.order} 页｜${page.type}｜${page.title}`,
      page.objective ? `目标：${page.objective}` : '',
      page.text ? `正文：${page.text}` : '',
      ...page.questions.map(
        (question, index) =>
          `问题 ${index + 1}：${question.question}${question.options.length ? `；选项：${question.options.map((option) => option.value).join(' / ')}` : ''}${question.answer.length ? `；答案：${question.answer.join('、')}` : ''}${question.analysis ? `；解析：${question.analysis}` : ''}`,
      ),
    ]
      .filter(Boolean)
      .join('\n');
    const cost = estimateTextTokens(detail);
    if (cost <= remaining) {
      included.push(detail);
      remaining -= cost;
      continue;
    }
    const excerpt = takeWithinTokenBudget(detail, remaining);
    if (excerpt.text) included.push(excerpt.text);
    omitted++;
    remaining = 0;
  }
  const order = new Map(source.pages.map((page, index) => [page.order, index]));
  included.sort((left, right) => {
    const leftOrder = Number(left.match(/第 (\d+) 页/u)?.[1] ?? 0);
    const rightOrder = Number(right.match(/第 (\d+) 页/u)?.[1] ?? 0);
    return (order.get(leftOrder) ?? 0) - (order.get(rightOrder) ?? 0);
  });
  return `${boundedHeader}\n相关课件内容：\n${included.join('\n\n')}${omitted ? `\n另有 ${omitted} 页未纳入本轮上下文，请勿据此推断其内容。` : ''}`;
}

const MATERIAL_CHUNK_CHARS = 600;
const MATERIAL_QUERY_STOPWORDS = new Set([
  '根据',
  '依据',
  '按照',
  '基于',
  '上传',
  '附件',
  '材料',
  '资料',
  '课件',
  '课程',
  '教学',
  '内容',
  '框架',
  '要求',
  '制作',
  '生成',
  '创建',
  '整理',
  '全文',
  '完整',
  '这个',
  '那个',
  '本轮',
  '需要',
  '可以',
  '符合',
  '相关',
  '帮助',
  '怎么',
  '如何',
  '请帮',
  '用户',
  '进行',
]);

interface MaterialChunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

function splitMaterialText(value: string): MaterialChunk[] {
  const chunks: MaterialChunk[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    let end = Math.min(value.length, cursor + MATERIAL_CHUNK_CHARS);
    if (end < value.length) {
      const boundaries = [
        value.lastIndexOf('\n\n', end),
        value.lastIndexOf('\n', end),
        value.lastIndexOf('。', end),
        value.lastIndexOf('；', end),
        value.lastIndexOf('. ', end),
      ];
      const boundary = Math.max(...boundaries);
      if (boundary >= cursor + Math.floor(MATERIAL_CHUNK_CHARS * 0.55)) {
        end = boundary + (value.startsWith('\n\n', boundary) ? 2 : value[boundary] === ' ' ? 2 : 1);
      }
    }
    const text = value.slice(cursor, end).trim();
    if (text) chunks.push({ index: chunks.length + 1, start: cursor, end, text });
    cursor = Math.max(end, cursor + 1);
  }
  return chunks;
}

function materialTerms(prompt: string): string[] {
  return keywords(prompt).filter(
    (term) => !MATERIAL_QUERY_STOPWORDS.has(term) && term.length <= 32,
  );
}

/** Rank local workspace files against the current request before including them in context. */
export function selectRelevantMaterials(
  materials: BotMaterial[],
  prompt: string,
  limit: number,
): BotMaterial[] {
  if (limit <= 0 || !materials.length) return [];
  if (materials.length <= limit) return materials;
  const terms = materialTerms(prompt).slice(0, 120);
  if (!terms.length) return materials.slice(0, limit);
  const ranked = materials.map((material, index) => {
    const filename = material.name.toLowerCase();
    const text = (material.extractedText ?? '').toLowerCase();
    const score = terms.reduce((total, term) => {
      const weight = Math.min(term.length, 5);
      let matches = filename.includes(term) ? 4 : 0;
      if (text) {
        const position = text.indexOf(term);
        if (position >= 0) {
          matches += 1;
          if (text.indexOf(term, position + term.length) >= 0) matches += 1;
        }
      }
      return total + matches * weight;
    }, 0);
    return { material, index, score };
  });
  return ranked
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map(({ material }) => material);
}

function spreadChunks(chunks: MaterialChunk[], budget: number): MaterialChunk[] {
  if (!chunks.length) return [];
  const average =
    chunks.reduce((total, chunk) => total + estimateTextTokens(chunk.text), 0) / chunks.length;
  const count = Math.max(1, Math.min(chunks.length, Math.floor(budget / Math.max(1, average))));
  if (count >= chunks.length) return chunks;
  if (count === 1) return [chunks[Math.floor((chunks.length - 1) / 2)]];
  return Array.from(
    { length: count },
    (_, index) => chunks[Math.round((index * (chunks.length - 1)) / (count - 1))]!,
  );
}

function scoreMaterialChunk(chunk: MaterialChunk, terms: string[]): number {
  const text = chunk.text.toLowerCase();
  return terms.reduce(
    (score, term) => (text.includes(term.toLowerCase()) ? score + Math.min(term.length, 5) : score),
    0,
  );
}

export function buildMaterialContext(
  materials: BotMaterial[],
  tokenBudget: number,
  prompt = '',
): string {
  if (!materials.length || tokenBudget <= 0) return '';
  const note =
    '资料说明：原始文件保存在本机；以下是根据本轮问题检索的原文片段，并非全文。生成任务只使用明确加入该任务的资料内容。';
  const noteCost = estimateTextTokens(note);
  let remaining = Math.max(0, tokenBudget - noteCost - 45);
  const terms = materialTerms(prompt);
  const sections: string[] = [];
  let omitted = 0;

  for (let index = 0; index < materials.length; index++) {
    const material = materials[index];
    const fullText = material.extractedText ?? '';
    const header =
      '【资料 ' +
      (index + 1) +
      '：' +
      material.name +
      (material.extractedPageCount ? '，' + material.extractedPageCount + ' 页' : '') +
      '，全文 ' +
      (material.extractedTextLength ?? fullText.length) +
      ' 字符' +
      (material.extractionTruncated ? '，本机文本索引已截取' : '') +
      '】';
    const headerCost = estimateTextTokens(header);
    const availableForMaterial = Math.floor(remaining / (materials.length - index));
    if (!fullText || availableForMaterial <= headerCost + 25) {
      omitted++;
      continue;
    }

    const chunks = splitMaterialText(fullText);
    const chunkBudget = availableForMaterial - headerCost;
    const scored = chunks.map((chunk) => ({ chunk, score: scoreMaterialChunk(chunk, terms) }));
    const matching = scored.filter((item) => item.score > 0);
    const candidates = matching.length
      ? matching
          .sort((left, right) => right.score - left.score || left.chunk.start - right.chunk.start)
          .map((item) => item.chunk)
      : spreadChunks(chunks, chunkBudget);
    const chosen: string[] = [];
    let materialUsed = headerCost;
    for (const chunk of candidates) {
      const label =
        '片段 ' +
        chunk.index +
        '/' +
        chunks.length +
        '（原文字符 ' +
        (chunk.start + 1) +
        '–' +
        chunk.end +
        '）：\n';
      const labelCost = estimateTextTokens(label);
      const excerpt = takeWithinTokenBudget(chunk.text, chunkBudget - materialUsed - labelCost);
      if (!excerpt.text) continue;
      chosen.push(label + excerpt.text);
      materialUsed += labelCost + estimateTextTokens(excerpt.text);
      if (materialUsed >= availableForMaterial - 20) break;
    }
    if (chosen.length) {
      sections.push(header + '\n' + chosen.join('\n\n'));
      remaining -= materialUsed;
      if (chosen.length < chunks.length || matching.length < chunks.length)
        omitted += chunks.length - chosen.length;
    } else {
      omitted++;
    }
  }

  const footer = omitted
    ? '\n另有 ' + omitted + ' 个原文片段未放入本轮上下文；可指定章节或关键词继续追问。'
    : '';
  return [note, ...sections, footer].filter(Boolean).join('\n\n');
}

export function selectCourseDirectory<T extends { id: string; name: string; sceneCount: number }>(
  courses: T[],
  prompt: string,
  selectedCourseId: string,
  limit: number,
): T[] {
  if (courses.length <= limit) return courses;
  const terms = keywords(prompt);
  const ranked = courses
    .map((course, index) => ({
      course,
      index,
      selected: course.id === selectedCourseId,
      score: terms.reduce(
        (total, term) => total + (course.name.toLowerCase().includes(term) ? term.length : 0),
        0,
      ),
    }))
    .sort(
      (a, b) => Number(b.selected) - Number(a.selected) || b.score - a.score || a.index - b.index,
    );
  return ranked.slice(0, limit).map(({ course }) => course);
}
