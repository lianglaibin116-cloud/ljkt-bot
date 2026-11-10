import type { BotAction, BotThread } from './contracts';

const COURSE_WORD = /(?:教学课件|课件|课程(?:大纲|内容|包)?|教学方案)/u;
const QUESTION_ONLY =
  /^(?:(?:请问|我想问(?:一下)?|想问(?:一下)?|请教(?:一下)?)[，,\s]*)?(?:(?:我)?(?:如何|怎么|怎样|能否|能不能|是否(?:可以|要|需要)?|可以不可以|可不可以)|(?:如果|假如|若).{0,12})(?:帮我|请你|替我)?(?:制作|生成|创建|做).{0,24}(?:教学课件|课件|课程|教学方案)/u;
const DECLINED =
  /(?:先别|暂不|暂时不|不要|不需要|不用|不想|不打算|先不).{0,10}(?:制作|生成|创建|做).{0,24}(?:教学课件|课件|课程|教学方案)/u;

export function isExplicitCourseCreationRequest(prompt: string): boolean {
  const value = prompt.replace(/\s+/gu, ' ').trim();
  if (!value || !COURSE_WORD.test(value) || QUESTION_ONLY.test(value) || DECLINED.test(value))
    return false;

  return (
    /(?:帮我|请(?:你)?|替我|我要|我想(?:要)?|需要|给我|根据|依据|基于|按照|按|制作|生成|创建|做一份|做一个|做个|出一份|编排|设计).{0,72}(?:教学课件|课件|课程|教学方案)/u.test(
      value,
    ) ||
    /(?:教学课件|课件|课程|教学方案).{0,18}(?:按|根据|依据|基于|进行|开始)?(?:制作|生成|创建|改编|编排)/u.test(
      value,
    )
  );
}

function cleanTitle(value: string): string {
  return value
    .replace(/\.(?:pdf|pptx?|docx?|txt|md)$/iu, '')
    .replace(/[\s:：，,。.!！?？]+$/gu, '')
    .trim()
    .slice(0, 180);
}

function deriveCourseTitle(prompt: string, materialNames: string[], assistantText: string): string {
  const assistantTitle =
    assistantText.match(
      /(?:课件标题|任务卡标题|标题(?:是|为|[:：]))\s*[《「“"']([^》」”"']{2,100})[》」”"']/u,
    )?.[1] ?? assistantText.match(/(?:标题是|标题为)\s*([^\n，。；]{2,80})/u)?.[1];
  if (assistantTitle && cleanTitle(assistantTitle)) return cleanTitle(assistantTitle);

  const promptTitle =
    prompt.match(/[《「“]([^》」”]{2,100})[》」”]/u)?.[1] ??
    prompt.match(
      /(?:关于|围绕|主题(?:是|为)?|课程(?:主题)?(?:是|为)?)\s*([^，。！？\n]{2,70})/u,
    )?.[1];
  if (promptTitle && cleanTitle(promptTitle)) return cleanTitle(promptTitle);

  if (materialNames.length) {
    const fileTitle = cleanTitle(materialNames[0]);
    if (fileTitle) return fileTitle;
  }

  const simplified = prompt
    .replace(
      /^(?:请|帮我|替我|我要|我想(?:要)?|根据.{0,30}?|依据.{0,30}?|基于.{0,30}?|按照.{0,30}?|按.{0,20}?)/u,
      '',
    )
    .replace(/^(?:制作|生成|创建|做)(?:一个|一份|一套|关于)?/u, '')
    .replace(/(?:的)?(?:教学课件|课件|课程|教学方案).*$/u, '')
    .trim();
  return cleanTitle(simplified) || '新建教学课件';
}

export function createFallbackCourseAction(
  prompt: string,
  materialNames: string[] = [],
  assistantText = '',
): Extract<BotAction, { type: 'prepare-course' }> | null {
  if (!isExplicitCourseCreationRequest(prompt)) return null;

  const sourcePrompt = prompt.length > 18_000 ? prompt.slice(0, 18_000) + '…' : prompt;
  const attachmentNote = materialNames.length
    ? '原始附件：' +
      materialNames.join('、') +
      '。请在大纲和课程内容生成阶段重新解析完整原文件；Bot 对话只使用检索片段，不代表附件全文。'
    : '';
  const requirement = [
    '教师原始要求：' + sourcePrompt,
    attachmentNote,
    '先进入大纲审阅流程，呈现课程结构并等待老师确认；确认后再生成课件正文。',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 19_900);

  const declinesInteraction = /(?:不要|无需|不需要|关闭|取消).{0,10}(?:互动|交互|实验|测验)/u.test(
    prompt,
  );
  return {
    type: 'prepare-course',
    title: deriveCourseTitle(prompt, materialNames, assistantText),
    requirement,
    interactive:
      !declinesInteraction &&
      /(?:互动|交互|可操作|模拟器|互动实验|随堂测验|编程练习)/u.test(prompt),
    teacherDemo: /(?:教师|老师).{0,6}(?:演示|示范)|演示模式/u.test(prompt),
  };
}

function assistantClaimsTaskCard(content: string): boolean {
  return (
    /(?:任务卡|制作卡).{0,80}(?:已准备|准备好|就绪|待执行|点击|入口)/u.test(content) ||
    /(?:已准备好|已经准备好).{0,60}(?:任务卡|制作卡)/u.test(content) ||
    /点击下方卡片|大纲审阅与课程生成流程/u.test(content)
  );
}

export function restoreMissingPreparedCourseActions(thread: BotThread): BotThread {
  let changed = false;
  const messages = thread.messages.map((message, index) => {
    if (
      message.role !== 'assistant' ||
      message.actions?.length ||
      !assistantClaimsTaskCard(message.content)
    )
      return message;
    const request = [...thread.messages.slice(0, index)]
      .reverse()
      .find((candidate) => candidate.role === 'user');
    if (!request) return message;
    const materialNames = (request.materials ?? thread.materials ?? []).map((item) => item.name);
    const action = createFallbackCourseAction(request.content, materialNames, message.content);
    if (!action) return message;
    changed = true;
    return {
      ...message,
      actions: [{ id: 'recovered-' + message.id, action, updatedAt: Date.now() }],
    };
  });
  return changed ? { ...thread, messages } : thread;
}
