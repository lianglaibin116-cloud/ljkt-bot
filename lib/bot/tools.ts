import { tool } from 'ai';
import { z } from 'zod';
import type { BotAction } from './contracts';

export function createBotTools(courses: Array<{ id: string; name: string; sceneCount: number }>) {
  return {
    list_courses: tool({
      description: '列出本 Bot 里实际保存的课件，不能把课程清单当作课程正文。',
      inputSchema: z.object({}),
      execute: async () => ({ courses }),
    }),
    prepare_course: tool({
      description:
        '用户明确要求制作课件后，准备制作任务卡。只准备任务，不表示已生成；老师点击后进入原有完整大纲审阅与课程生成流程。',
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        requirement: z
          .string()
          .min(1)
          .max(20000)
          .describe('完整教学要求，包括已确认的学科、学段、目标、课时和页数；不编造未给信息'),
        interactive: z.boolean().describe('需要实验模拟、互动、测验时为true'),
        teacherDemo: z.boolean().describe('明确要求教师演示模式时为true'),
      }),
      execute: async (input): Promise<{ action: BotAction }> => ({
        action: { type: 'prepare-course', ...input },
      }),
    }),
    open_course: tool({
      description:
        '打开已保存课件的授课、专业编辑、教师计划或学生笔记。课程资料仍由老师按需生成；export打开课件，由右上角导出菜单选择格式，不声称文件已经生成。',
      inputSchema: z.object({
        courseId: z.string(),
        view: z.enum(['playback', 'edit', 'teacher-plan', 'student-notes', 'export']),
      }),
      execute: async ({ courseId, view }) => {
        const course = courses.find((item) => item.id === courseId);
        if (!course) return { error: '没有找到这份课件，请先选择或导入。' };
        return {
          action: { type: 'open-course', courseId, title: course.name, view } satisfies BotAction,
        };
      },
    }),
  };
}

export const BOT_SYSTEM_PROMPT = `你是灵境课堂 Bot，面向老师的独立备课助手。用中文清楚回答。
你可以讨论知识、规划课程，通过工具准备课件任务或打开真实课程。只在用户明确要求制作时准备制作卡，不把普通问答变成课件生成。
制作卡只是待执行入口。不能声称已完成课件、修改、资料生成、保存或导出；老师实际执行和保存后才有这些成果。
Bot 内通过左侧‘我的课件’打开已保存课程，再按需授课或编辑；不要打开网页端教师备课首页。
课程资料和导出基于实际保存课件。缺少学段或目标时可简短询问，或在要求里注明由老师在大纲阶段确认。对已有课程只使用提供的真实正文；没有正文就不要猜测页内容。
附件清单只有文件名，不能声称已经读过其内容；附件会在实际制作流程中解析。不要要求用户提供API密钥到聊天里，模型配置使用设置窗口。`;
