import Dexie, { type Table } from 'dexie';

export interface BotCourseLibraryEntry {
  stageId: string;
  archivedAt?: number;
  updatedAt: number;
}

class BotCourseLibraryDatabase extends Dexie {
  entries!: Table<BotCourseLibraryEntry, string>;
  constructor() {
    super('ljkt-bot-course-library');
    this.version(1).stores({ entries: 'stageId,archivedAt,updatedAt' });
  }
}
let database: BotCourseLibraryDatabase | undefined;
const db = () => (database ??= new BotCourseLibraryDatabase());

export async function listBotCourseLibraryEntries(): Promise<BotCourseLibraryEntry[]> {
  return db().entries.toArray();
}

export async function archiveBotCourse(stageId: string): Promise<void> {
  await db().entries.put({ stageId, archivedAt: Date.now(), updatedAt: Date.now() });
}

export async function restoreBotCourse(stageId: string): Promise<void> {
  await db().entries.delete(stageId);
}

export async function permanentlyRemoveBotCourseEntry(stageId: string): Promise<void> {
  await db().entries.delete(stageId);
}
