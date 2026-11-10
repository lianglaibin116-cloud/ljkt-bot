import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), stream: vi.fn() }));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModelFromRequest: mocks.resolve }));
vi.mock('@/lib/ai/llm', () => ({ streamLLM: mocks.stream }));
import { POST } from '@/app/api/bot/chat/route';

const request = (body: unknown, origin = 'http://localhost:3010') =>
  new NextRequest('http://localhost:3010/api/bot/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'localhost:3010', origin },
    body: JSON.stringify(body),
  });
const input = { messages: [{ role: 'user', content: '制作勾股定理课程' }], courses: [] };
afterEach(() => vi.resetAllMocks());

describe('Bot model route', () => {
  it('streams text and validated task cards through the existing model resolver', async () => {
    mocks.resolve.mockResolvedValue({ model: {}, modelInfo: { outputWindow: 8192 } });
    mocks.stream.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: '先审阅大纲。' };
        yield {
          type: 'tool-result',
          toolCallId: 'task-1',
          output: {
            action: {
              type: 'prepare-course',
              title: '勾股定理',
              requirement: '初中六页课程',
              interactive: true,
              teacherDemo: false,
            },
          },
        };
      })(),
    });
    const response = await POST(request(input));
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(['text', 'action', 'done']);
    expect(events[1].action.title).toBe('勾股定理');
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'chat-adapter',
    );
    expect(mocks.stream.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it('preserves partial output and reports an upstream failure without leaking details', async () => {
    mocks.resolve.mockResolvedValue({ model: {} });
    mocks.stream.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: '已收到的内容' };
        yield { type: 'error', error: new Error('private-provider-details') };
      })(),
    });
    const response = await POST(request(input));
    const output = await response.text();
    expect(output).toContain('已收到的内容');
    expect(output).toContain('"type":"error"');
    expect(output).not.toContain('private-provider-details');
  });
  it('rejects cross-origin and malformed requests before invoking a model', async () => {
    expect((await POST(request(input, 'https://unrelated.example'))).status).toBe(403);
    expect((await POST(request({ messages: [], courses: [] }))).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('accepts the actual same-origin Host when Next normalizes its internal URL', async () => {
    const req = new NextRequest('http://localhost:30310/api/bot/chat', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:30310',
        origin: 'http://127.0.0.1:30310',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect((await POST(req)).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('cancels the provider stream when the consumer stops reading', async () => {
    mocks.resolve.mockResolvedValue({ model: {} });
    let signal: AbortSignal | undefined;
    mocks.stream.mockImplementation((params) => {
      signal = params.abortSignal;
      return {
        fullStream: (async function* () {
          yield { type: 'text-delta', text: '开始' };
          await new Promise<void>((resolve) => {
            if (signal!.aborted) resolve();
            else signal!.addEventListener('abort', () => resolve(), { once: true });
          });
        })(),
      };
    });
    const response = await POST(request(input));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal?.aborted).toBe(true);
  });
});
