import Dexie, { type Table } from 'dexie';
import type { GenerationSessionState } from '@/app/generation-preview/types';

export interface BotTaskCheckpoint {
  id: string;
  threadId: string;
  actionId: string;
  sessionId: string;
  /** Course created from this task, if generation reached the classroom phase. */
  courseId?: string;
  /** Inputs needed by ClassroomSurface to resume the remaining generated scenes. */
  courseGenerationParams?: Record<string, unknown>;
  session: GenerationSessionState;
  updatedAt: number;
}

class BotTaskDatabase extends Dexie {
  checkpoints!: Table<BotTaskCheckpoint, string>;
  constructor() {
    super('ljkt-bot-tasks');
    this.version(1).stores({ checkpoints: 'id,threadId,updatedAt' });
  }
}
let database: BotTaskDatabase | undefined;
const db = () => (database ??= new BotTaskDatabase());

/** Keep restartable task input and progress, but never copy provider secrets into task history. */
export async function saveBotTaskCheckpoint(
  checkpoint: Omit<BotTaskCheckpoint, 'session'> & { session: GenerationSessionState },
): Promise<void> {
  const { pdfProviderConfig: _credentials, ...session } = checkpoint.session;
  await db().checkpoints.put({ ...checkpoint, session });
}

export async function loadBotTaskCheckpoint(id: string): Promise<BotTaskCheckpoint | undefined> {
  return db().checkpoints.get(id);
}

export async function listBotTaskCheckpoints(threadId: string): Promise<BotTaskCheckpoint[]> {
  return db().checkpoints.where('threadId').equals(threadId).toArray();
}

export async function deleteBotTaskCheckpoint(id: string): Promise<void> {
  await db().checkpoints.delete(id);
}
