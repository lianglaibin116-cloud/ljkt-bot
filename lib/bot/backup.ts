import JSZip from 'jszip';
import { z } from 'zod';
import {
  MAX_BOT_MATERIAL_TEXT_CHARS,
  botActionSchema,
  type BotMaterial,
  type BotThread,
} from './contracts';
import { listBotTaskCheckpoints, type BotTaskCheckpoint } from './tasks';
import { deleteDocumentBlob, loadDocumentBlob, storeDocumentBlob } from '@/lib/utils/image-storage';

const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 200 * 1024 * 1024;
const materialSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(250),
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
  lastModified: z.number().optional(),
  mimeType: z.string().max(200).optional(),
  order: z.number().int().positive(),
  storageKey: z.string().min(1).max(500),
  assetId: z.string().max(500).optional(),
  contentDigest: z.string().max(200).optional(),
  providerId: z.string().max(100).optional(),
  extractedText: z.string().max(MAX_BOT_MATERIAL_TEXT_CHARS).optional(),
  extractedPageCount: z.number().int().nonnegative().optional(),
  extractedTextLength: z.number().int().nonnegative().max(20_000_000).optional(),
  extractionTruncated: z.boolean().optional(),
  extractionError: z.string().max(1000).optional(),
});
const messageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  content: z.string().max(500000),
  actions: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        action: botActionSchema,
        status: z.enum(['ready', 'running', 'failed', 'cancelled', 'complete']).optional(),
        taskId: z.string().max(200).optional(),
        sessionId: z.string().max(200).optional(),
        courseId: z.string().max(200).optional(),
        error: z.string().max(5000).optional(),
        updatedAt: z.number().optional(),
      }),
    )
    .max(100)
    .optional(),
  status: z.enum(['complete', 'streaming', 'cancelled', 'failed']).optional(),
  error: z.string().max(5000).optional(),
  materials: z.array(materialSchema).max(8).optional(),
});
const botThreadSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(250),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  selectedCourseId: z.string().max(200).optional(),
  workspace: z
    .object({ url: z.string().max(4000), title: z.string().max(250) })
    .nullable()
    .optional(),
  materials: z.array(materialSchema).max(8).optional(),
  messages: z.array(messageSchema).max(10000),
});
const taskSchema = z.object({
  id: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200),
  actionId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  courseId: z.string().max(200).optional(),
  courseGenerationParams: z.record(z.string(), z.unknown()).optional(),
  session: z.record(z.string(), z.unknown()),
  updatedAt: z.number().finite(),
});
const manifestSchema = z.object({
  format: z.literal('ljkt-bot-backup'),
  version: z.literal(1),
  createdAt: z.number().finite(),
  thread: botThreadSchema,
  tasks: z.array(taskSchema).max(500),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1),
        path: z.string().regex(/^materials\/[A-Za-z0-9_-]+\/[^/]{1,250}$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
        mimeType: z.string().max(200),
      }),
    )
    .max(8),
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function collectMaterials(thread: BotThread): BotMaterial[] {
  const byId = new Map<string, BotMaterial>();
  for (const material of thread.materials ?? []) byId.set(material.id, material);
  for (const message of thread.messages)
    for (const material of message.materials ?? [])
      if (!byId.has(material.id)) byId.set(material.id, material);
  return Array.from(byId.values());
}

function remapStorageKeys<T>(value: T, keys: Map<string, string>): T {
  if (Array.isArray(value)) return value.map((item) => remapStorageKeys(item, keys)) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'storageKey' && typeof child === 'string' && keys.has(child))
      result[key] = keys.get(child);
    else result[key] = remapStorageKeys(child, keys);
  }
  return result as T;
}

function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(api.?key|access.?key.?secret|access.?key.?id|password|authorization|token)$/i.test(key))
      continue;
    result[key] = redactSecrets(child);
  }
  return result as T;
}

export async function createBotBackup(thread: BotThread): Promise<Blob> {
  const zip = new JSZip();
  const materials = collectMaterials(thread);
  let totalBytes = 0;
  const manifestMaterials: Array<{
    id: string;
    path: string;
    sha256: string;
    size: number;
    mimeType: string;
  }> = [];
  const keyMap = new Map<string, string>();
  for (const material of materials) {
    const blob = await loadDocumentBlob(material.storageKey);
    if (!blob) throw new Error(`本机找不到材料《${material.name}》，无法制作完整备份。`);
    if (blob.size > MAX_ATTACHMENT_BYTES || totalBytes + blob.size > MAX_TOTAL_ATTACHMENT_BYTES)
      throw new Error('附件总量超过完整备份限制（单份 50 MB，总计 200 MB）。');
    const path = `materials/${material.id}/${material.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || 'material'}`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    zip.file(path, bytes);
    totalBytes += bytes.byteLength;
    manifestMaterials.push({
      id: material.id,
      path,
      sha256: await sha256(bytes),
      size: bytes.byteLength,
      mimeType: material.mimeType || blob.type || 'application/octet-stream',
    });
    keyMap.set(material.storageKey, `backup-material:${material.id}`);
  }
  const portableThread = remapStorageKeys(thread, keyMap);
  for (const material of portableThread.materials ?? [])
    material.storageKey = `backup-material:${material.id}`;
  for (const message of portableThread.messages)
    for (const material of message.materials ?? [])
      material.storageKey = `backup-material:${material.id}`;
  const tasks = await listBotTaskCheckpoints(thread.id);
  const portableTasks = redactSecrets(tasks.map((task) => remapStorageKeys(task, keyMap)));
  zip.file(
    'manifest.json',
    JSON.stringify({
      format: 'ljkt-bot-backup',
      version: 1,
      createdAt: Date.now(),
      thread: portableThread,
      tasks: portableTasks,
      attachments: manifestMaterials,
    }),
  );
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function restoreBotBackup(
  file: File,
): Promise<{ thread: BotThread; tasks: BotTaskCheckpoint[] }> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 300 MB。');
  const zip = await JSZip.loadAsync(file, { checkCRC32: true });
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('备份缺少 manifest.json。');
  const manifestBytes = (manifestEntry as unknown as { _data?: { uncompressedSize?: number } })
    ._data?.uncompressedSize;
  if (typeof manifestBytes === 'number' && manifestBytes > 5 * 1024 * 1024)
    throw new Error('备份清单超过 5 MB，已拒绝读取。');
  const parsed = manifestSchema.safeParse(JSON.parse(await manifestEntry.async('string')));
  if (!parsed.success) throw new Error('备份格式不受支持或内容不完整。');
  const manifest = parsed.data;
  let totalBytes = 0;
  const keyMap = new Map<string, string>();
  const createdKeys: string[] = [];
  try {
    for (const item of manifest.attachments) {
      const entry = zip.file(item.path);
      if (!entry) throw new Error(`备份附件缺失：${item.path}`);
      const declaredBytes = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (typeof declaredBytes === 'number' && declaredBytes > MAX_ATTACHMENT_BYTES)
        throw new Error(`附件超过 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB 恢复限制。`);
      const bytes = await entry.async('uint8array');
      totalBytes += bytes.byteLength;
      if (
        bytes.byteLength !== item.size ||
        bytes.byteLength > MAX_ATTACHMENT_BYTES ||
        totalBytes > MAX_TOTAL_ATTACHMENT_BYTES
      )
        throw new Error('备份附件大小与清单不一致，或超过恢复限制。');
      if ((await sha256(bytes)) !== item.sha256) throw new Error(`附件校验失败：${item.path}`);
      const source =
        (manifest.thread.materials as BotMaterial[] | undefined)?.find(
          (material) => material.id === item.id,
        ) ??
        (manifest.thread.messages as Array<{ materials?: BotMaterial[] }>)
          .flatMap((message) => message.materials ?? [])
          .find((material) => material.id === item.id);
      if (!source) throw new Error(`备份缺少附件元数据：${item.id}`);
      const newStorageKey = await storeDocumentBlob(
        new File([Uint8Array.from(bytes).buffer], source.name, { type: item.mimeType }),
      );
      keyMap.set(`backup-material:${item.id}`, newStorageKey);
      createdKeys.push(newStorageKey);
    }
  } catch (error) {
    await Promise.allSettled(createdKeys.map((key) => deleteDocumentBlob(key)));
    throw error;
  }
  const thread = remapStorageKeys(manifest.thread as unknown as BotThread, keyMap);
  const tasks = manifest.tasks.map((task) =>
    remapStorageKeys(task as unknown as BotTaskCheckpoint, keyMap),
  );
  return { thread, tasks };
}

export async function saveRestoredBotTasks(tasks: BotTaskCheckpoint[]): Promise<void> {
  const { saveBotTaskCheckpoint } = await import('./tasks');
  for (const task of tasks) await saveBotTaskCheckpoint(task);
}
