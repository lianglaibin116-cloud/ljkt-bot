import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { scenes, source, stage } from './fixtures';

const mocks = vi.hoisted(() => ({
  callLLM: vi.fn(),
  resolveModel: vi.fn(),
  pool: { query: vi.fn() },
  loadDocument: vi.fn(),
  owner: vi.fn(),
}));
vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModelFromRequest: mocks.resolveModel }));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ pool: mocks.pool }),
}));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: async () => ({ loadDocument: mocks.loadDocument }),
}));
vi.mock('@/lib/server/agent-runtime/owner', () => ({ resolveRequestOwnerId: mocks.owner }));
import { POST } from '@/app/api/generate/course-documents/route';

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/generate/course-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  mocks.owner.mockImplementation((_req, headers: Headers) => {
    headers.append('Set-Cookie', 'test-owner=1');
    return 'owner-1';
  });
  mocks.resolveModel.mockResolvedValue({
    model: { modelId: 'fixture' },
    modelInfo: { contextWindow: 32000, outputWindow: 8000 },
  });
  mocks.pool.query.mockResolvedValue({ rows: [{ stage_id: stage.id }] });
  mocks.loadDocument.mockResolvedValue({ stage, scenes });
  mocks.callLLM.mockImplementation(async ({ prompt }) => {
    const pages = JSON.parse(prompt).pages;
    return {
      text: JSON.stringify({
        title: '笔记',
        sections: [
          {
            id: 's1',
            title: '知识',
            content: '测试内容',
            sourceSceneIds: pages.map((p: { id: string }) => p.id),
          },
        ],
        warnings: [],
      }),
    };
  });
});

describe('POST course documents', () => {
  it('supports local courses without a database and streams a complete validated document', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const response = await POST(
      request({ kind: 'student-notes', stageId: stage.id, storageMode: 'local', source: source() }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const events = await response.text();
    expect(events).toContain('event: progress');
    expect(events).toContain('event: complete');
    expect(events).toContain('由9＋16');
    expect(mocks.pool.query).not.toHaveBeenCalled();
    expect(mocks.resolveModel.mock.calls[0][2]).toBe('course-documents');
  });
  it('loads the authoritative owned server course instead of trusting client content', async () => {
    const spoof = source();
    spoof.pages[0].text = 'CLIENT SPOOF';
    const response = await POST(
      request({ kind: 'teacher-plan', stageId: stage.id, storageMode: 'server', source: spoof }),
    );
    await response.text();
    expect(mocks.callLLM.mock.calls[0][0].prompt).not.toContain('CLIENT SPOOF');
    expect(mocks.callLLM.mock.calls[0][0].prompt).toContain('直角三角形');
  });
  it('refuses a foreign or absent course before calling the model', async () => {
    mocks.pool.query.mockResolvedValue({ rows: [] });
    const response = await POST(
      request({ kind: 'teacher-plan', stageId: stage.id, storageMode: 'server' }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toContain('test-owner');
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });
  it('refuses unfinished server courses, invalid kinds and mismatching ids', async () => {
    mocks.loadDocument.mockResolvedValue({
      stage,
      scenes,
      outline: { outlines: [{ id: 'missing', order: 99 }] },
    });
    expect(
      (await POST(request({ kind: 'teacher-plan', stageId: stage.id, storageMode: 'server' })))
        .status,
    ).toBe(409);
    expect(
      (
        await POST(
          request({ kind: 'wrong', stageId: stage.id, storageMode: 'local', source: source() }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            kind: 'teacher-plan',
            stageId: 'different',
            storageMode: 'local',
            source: source(),
          }),
        )
      ).status,
    ).toBe(400);
  });
  it('allows an intentionally deleted page in an already completed course', async () => {
    mocks.loadDocument.mockResolvedValue({
      stage,
      scenes,
      outline: { generationComplete: true, outlines: [{ id: 'deleted-page', order: 99 }] },
    });
    const response = await POST(
      request({ kind: 'teacher-plan', stageId: stage.id, storageMode: 'server' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: complete');
  });
  it('reports an upstream failure without publishing a partial complete result', async () => {
    mocks.callLLM.mockRejectedValue(new Error('provider unavailable'));
    const response = await POST(
      request({ kind: 'teacher-plan', stageId: stage.id, storageMode: 'local', source: source() }),
    );
    const events = await response.text();
    expect(events).toContain('event: error');
    expect(events).not.toContain('event: complete');
    expect(mocks.callLLM).toHaveBeenCalledTimes(1);
  });
  it('checks the streamed body byte limit', async () => {
    const req = new NextRequest('http://localhost/api/generate/course-documents', {
      method: 'POST',
      headers: { 'content-length': '3000001' },
      body: '{}',
    });
    expect((await POST(req)).status).toBe(413);
  });
  it('rejects unreadable courses before resolving or calling a paid model', async () => {
    const empty = source();
    empty.pages = empty.pages.map((page) => ({ ...page, text: '', questions: [] }));
    const response = await POST(
      request({ kind: 'teacher-plan', stageId: stage.id, storageMode: 'local', source: empty }),
    );
    expect(response.status).toBe(400);
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });
});
