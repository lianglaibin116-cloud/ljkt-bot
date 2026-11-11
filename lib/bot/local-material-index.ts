import { STANDALONE_MANIFEST_ELEMENT_ID } from '@/lib/export/standalone-html/contract';
import type { BotMaterial } from './contracts';
import { loadDocumentBlob } from '@/lib/utils/image-storage';

export const LOCAL_INDEX_UNSUPPORTED = '本机检索暂不支持此文件格式';
const MAX_INDEX_CHARS = 500_000;

function manifestText(raw: string): string {
  try {
    const data = JSON.parse(raw) as unknown;
    const included = new Set([
      'name',
      'title',
      'description',
      'summary',
      'objective',
      'text',
      'content',
      'question',
      'answer',
      'options',
      'explanation',
      'feedback',
      'hint',
      'label',
      'caption',
      'alt',
      'placeholder',
      'narration',
      'transcript',
    ]);
    const ignored = new Set([
      'id',
      'url',
      'src',
      'mediaref',
      'audioid',
      'videomanifest',
      'mediaindex',
      'createdat',
      'updatedat',
      'duration',
      'color',
      'font',
      'style',
      'voiceconfig',
      'voicedesign',
    ]);
    const parts: string[] = [];
    const visit = (value: unknown, key = '', depth = 0) => {
      if (depth > 40 || value == null) return;
      const normalizedKey = key.toLowerCase();
      if (ignored.has(normalizedKey)) return;
      if (typeof value === 'string') {
        if (normalizedKey === 'html') parts.push(staticHtmlText(value, false));
        else if (included.has(normalizedKey)) parts.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) visit(item, key, depth + 1);
      } else if (typeof value === 'object') {
        for (const [childKey, child] of Object.entries(value)) visit(child, childKey, depth + 1);
      }
    };
    visit(data);
    return parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}

function staticHtmlText(source: string, includeManifest = true): string {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const manifestRaw = includeManifest
    ? (parsed.getElementById(STANDALONE_MANIFEST_ELEMENT_ID)?.textContent ?? '')
    : '';
  const embeddedCourseText = manifestRaw ? manifestText(manifestRaw) : '';
  parsed
    .querySelectorAll(
      'script,style,svg,canvas,iframe,object,embed,template,noscript,[hidden],[aria-hidden="true"]',
    )
    .forEach((element) => element.remove());
  const descriptions = Array.from(
    parsed.querySelectorAll('meta[name="description"],meta[property="og:description"]'),
  )
    .map((element) => element.getAttribute('content')?.trim() ?? '')
    .filter(Boolean);
  const imageAlt = Array.from(parsed.body.querySelectorAll('img[alt]'))
    .map((element) => element.getAttribute('alt')?.trim() ?? '')
    .filter(Boolean)
    .map((value) => `[图片：${value}]`);
  const visibleText = (parsed.body.innerText || parsed.body.textContent || '')
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return [descriptions.join('\n'), visibleText, imageAlt.join('\n'), embeddedCourseText]
    .filter(Boolean)
    .join('\n\n');
}

async function readLocalText(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('\ufffd')) {
    try {
      text = new TextDecoder('gb18030').decode(bytes);
    } catch {
      /* Keep UTF-8 replacement characters if the legacy decoder is unavailable. */
    }
  }
  return text;
}

function localKind(material: BotMaterial): 'html' | 'markdown' | 'text' | undefined {
  const extension = material.name.split('.').pop()?.toLowerCase();
  if (extension === 'html' || extension === 'htm' || material.mimeType === 'text/html')
    return 'html';
  if (
    extension === 'md' ||
    extension === 'markdown' ||
    material.mimeType === 'text/markdown' ||
    material.mimeType === 'text/x-markdown'
  )
    return 'markdown';
  if (extension === 'txt' || material.mimeType === 'text/plain') return 'text';
  return undefined;
}

export async function indexKnowledgeMaterialLocally(
  material: BotMaterial,
  signal: AbortSignal,
): Promise<{ material: BotMaterial; unsupported: boolean }> {
  if (material.extractedText) return { material, unsupported: false };
  if (material.extractionError?.startsWith(LOCAL_INDEX_UNSUPPORTED))
    return { material, unsupported: true };
  const kind = localKind(material);
  if (!kind) {
    return {
      material: { ...material, extractionError: `${LOCAL_INDEX_UNSUPPORTED}（${material.name}）` },
      unsupported: true,
    };
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const blob = await loadDocumentBlob(material.storageKey);
  if (!blob) throw new Error(`本机找不到材料《${material.name}》，请重新添加后再发送。`);
  const raw = await readLocalText(blob);
  let text =
    kind === 'html'
      ? staticHtmlText(raw)
      : kind === 'markdown'
        ? raw.replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gmu, '').trim()
        : raw.trim();
  const fullLength = text.length;
  text = text.slice(0, MAX_INDEX_CHARS);
  if (!text) throw new Error(`材料《${material.name}》没有提取到可检索的文字。`);
  return {
    material: {
      ...material,
      extractedText: text,
      extractedTextLength: fullLength,
      extractionTruncated: fullLength > MAX_INDEX_CHARS,
      extractionError: undefined,
    },
    unsupported: false,
  };
}

export async function indexKnowledgeFolderLocally(
  materials: BotMaterial[],
  signal: AbortSignal,
  onProgress: (finished: number, total: number) => void,
): Promise<{ materials: BotMaterial[]; unsupportedNames: string[] }> {
  const result = [...materials];
  const unsupportedNames: string[] = [];
  let cursor = 0;
  let finished = 0;
  const worker = async () => {
    while (cursor < materials.length) {
      const index = cursor++;
      const material = materials[index];
      if (!material) continue;
      const indexed = await indexKnowledgeMaterialLocally(material, signal);
      result[index] = indexed.material;
      if (indexed.unsupported) unsupportedNames.push(material.name);
      finished++;
      onProgress(finished, materials.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, materials.length) }, worker));
  return { materials: result, unsupportedNames };
}
