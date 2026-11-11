import Dexie, { type Table } from 'dexie';
import type { BotKnowledgeFolder, BotThread } from './contracts';
import { restoreMissingPreparedCourseActions } from './task-intent';

class BotDatabase extends Dexie {
  threads!: Table<BotThread, string>;
  knowledgeFolders!: Table<BotKnowledgeFolder, string>;
  constructor() {
    super('ljkt-bot-conversations');
    this.version(1).stores({ threads: 'id,updatedAt' });
    this.version(2).stores({ threads: 'id,updatedAt', knowledgeFolders: 'id,name,updatedAt' });
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

export async function listBotKnowledgeFolders(): Promise<BotKnowledgeFolder[]> {
  return db().knowledgeFolders.orderBy('updatedAt').reverse().toArray();
}

export async function saveBotKnowledgeFolder(folder: BotKnowledgeFolder): Promise<void> {
  await db().knowledgeFolders.put(folder);
}

export async function getBotKnowledgeFolder(id: string): Promise<BotKnowledgeFolder | undefined> {
  return db().knowledgeFolders.get(id);
}

export async function deleteBotKnowledgeFolder(id: string): Promise<void> {
  await db().knowledgeFolders.delete(id);
}
