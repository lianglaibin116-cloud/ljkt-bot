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

export function buildMaterialContext(materials: BotMaterial[], tokenBudget: number): string {
  let remaining = tokenBudget;
  const sections: string[] = [];
  let omitted = 0;
  for (const [index, material] of materials.entries()) {
    const header = `【资料 ${index + 1}：${material.name}${material.extractedPageCount ? `，${material.extractedPageCount} 页` : ''}${material.extractionTruncated ? '，保存的正文已截取' : ''}】\n`;
    const headerCost = estimateTextTokens(header);
    if (remaining <= headerCost + 30) {
      omitted++;
      continue;
    }
    const excerpt = takeWithinTokenBudget(material.extractedText ?? '', remaining - headerCost);
    if (excerpt.text) {
      sections.push(`${header}${excerpt.text}`);
      remaining -= headerCost + estimateTextTokens(excerpt.text);
      if (excerpt.truncated) omitted++;
    } else {
      omitted++;
    }
  }
  return `${sections.join('\n\n')}${omitted ? `\n\n另有 ${omitted} 份资料或正文部分未纳入本轮上下文；可继续提问指定资料或章节。` : ''}`;
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
