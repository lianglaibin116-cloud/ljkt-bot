import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteBotThread, listBotThreads, saveBotThread } from '@/lib/bot/conversations';

describe('Bot local conversations', () => {
  it('restores interrupted replies without showing a fake running task and does not affect other threads', async () => {
    await saveBotThread({
      id: 'thread-a',
      title: 'A',
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: 'm1', role: 'assistant', content: '尚未说完', status: 'streaming' }],
    });
    await saveBotThread({
      id: 'thread-b',
      title: 'B',
      createdAt: 1,
      updatedAt: 3,
      messages: [{ id: 'm2', role: 'user', content: '另一份对话' }],
    });
    const restored = await listBotThreads();
    expect(restored.map((item) => item.id)).toEqual(['thread-b', 'thread-a']);
    expect(restored[1].messages[0]).toMatchObject({ content: '尚未说完', status: 'cancelled' });
    await deleteBotThread('thread-a');
    expect((await listBotThreads()).map((item) => item.id)).toEqual(['thread-b']);
    await deleteBotThread('thread-b');
  });
});
