import Dexie, { type Table } from 'dexie';
import type { BotThread } from './contracts';

class BotDatabase extends Dexie {
  threads!: Table<BotThread, string>;
  constructor() {
    super('ljkt-bot-conversations');
    this.version(1).stores({ threads: 'id,updatedAt' });
  }
}
let database: BotDatabase | undefined;
const db = () => (database ??= new BotDatabase());

export async function listBotThreads(): Promise<BotThread[]> {
  return (await db().threads.orderBy('updatedAt').reverse().toArray()).map((thread) => ({
    ...thread,
    messages: thread.messages.map((message) =>
      message.status === 'streaming'
        ? { ...message, status: 'cancelled', error: '上次回复已中断，可继续提问。' }
        : message,
    ),
  }));
}
export async function saveBotThread(thread: BotThread): Promise<void> {
  await db().threads.put(thread);
}
export async function deleteBotThread(id: string): Promise<void> {
  await db().threads.delete(id);
}
