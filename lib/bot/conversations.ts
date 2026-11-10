import Dexie, { type Table } from 'dexie';
import type { BotThread } from './contracts';
import { restoreMissingPreparedCourseActions } from './task-intent';

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
  const threads = (await db().threads.orderBy('updatedAt').reverse().toArray()).map((thread) => ({
    ...thread,
    messages: thread.messages.map((message) =>
      message.status === 'streaming'
        ? { ...message, status: 'cancelled' as const, error: '上次回复已中断，可继续提问。' }
        : message,
    ),
  }));
  const repaired = threads.map(restoreMissingPreparedCourseActions);
  const changed = repaired.filter((thread, index) => thread !== threads[index]);
  if (changed.length) await db().threads.bulkPut(changed);
  return repaired;
}
export async function saveBotThread(thread: BotThread): Promise<void> {
  await db().threads.put(thread);
}
export async function deleteBotThread(id: string): Promise<void> {
  await db().threads.delete(id);
}
