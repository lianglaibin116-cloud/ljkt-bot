'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { Streamdown } from 'streamdown';
import { toast } from 'sonner';
import { createMathPlugin } from '@streamdown/math';
import {
  ArrowUp,
  Activity,
  Archive,
  BookOpen,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  LayoutPanelLeft,
  Loader2,
  Maximize2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Plus,
  Settings,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SettingsDialog } from '@/components/settings';
import { BotCourseLibrary } from '@/components/bot/BotCourseLibrary';
import { BotCourseSetup, type BotCourseSetupOptions } from '@/components/bot/BotCourseSetup';
import { OutlinesEditor } from '@/components/generation/outlines-editor';
import { useSettingsStore } from '@/lib/store/settings';
import { hasUsableLLMProvider } from '@/lib/store/settings-validation';
import { getCurrentModelConfig, getStageRoutesHeaderValue } from '@/lib/utils/model-config';
import { listStages, loadStageData, type StageListItem } from '@/lib/utils/stage-storage';
import { deleteDocumentBlob, loadDocumentBlob, storeDocumentBlob } from '@/lib/utils/image-storage';
import { normalizeDocumentMimeType } from '@/lib/document/mime';
import { extractCourseDocumentSource } from '@/lib/course-documents/source';
import {
  indexKnowledgeFolderLocally,
  indexKnowledgeMaterialLocally,
} from '@/lib/bot/local-material-index';
import {
  deleteBotKnowledgeFolder,
  deleteBotThread,
  getBotKnowledgeFolder,
  listBotKnowledgeFolders,
  listBotThreads,
  saveBotKnowledgeFolder,
  saveBotThread,
} from '@/lib/bot/conversations';
import {
  actionPath,
  MAX_BOT_MATERIAL_TEXT_CHARS,
  readBotEvents,
  type BotAction,
  type BotKnowledgeFolder,
  type BotMaterial,
  type BotMessage,
  type BotThread,
} from '@/lib/bot/contracts';
import { generationSessionKey } from '@/lib/bot/generation-handoff';
import { createBotBackup, restoreBotBackup, saveRestoredBotTasks } from '@/lib/bot/backup';
import { buildBotCourseSession } from '@/lib/bot/course-session';
import {
  buildCourseContext,
  buildMaterialContext,
  estimateTextTokens,
  selectRelevantMaterials,
  selectCourseDirectory,
  selectRecentMessages,
} from '@/lib/bot/context-budget';
import {
  deleteBotTaskCheckpoint,
  listBotTaskCheckpoints,
  loadBotTaskCheckpoint,
  saveBotTaskCheckpoint,
} from '@/lib/bot/tasks';
import type { SessionDocumentSource } from '@/lib/types/generation';
import type { SceneOutline } from '@/lib/types/generation';
import './bot.css';

const math = { math: createMathPlugin({ singleDollarTextMath: false }) };
const viewNames = {
  playback: '打开课件',
  edit: '专业编辑',
  'teacher-plan': '教师课程计划',
  'student-notes': '学生课堂笔记',
  export: '打开导出菜单',
};
const makeThread = (): BotThread => ({
  id: nanoid(),
  title: '新对话',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
const MAX_KNOWLEDGE_FOLDER_FILES = 30;
const MAX_KNOWLEDGE_FOLDER_BYTES = 200 * 1024 * 1024;

function toDocumentSource({
  extractedText: _text,
  extractedTextLength: _textLength,
  extractedPageCount: _pageCount,
  extractionTruncated: _truncated,
  extractionError: _error,
  ...source
}: BotMaterial): SessionDocumentSource {
  return source;
}

const actionLabel = (action: BotAction) =>
  action.type === 'prepare-course'
    ? '开始整理大纲'
    : action.type === 'open-workspace'
      ? '返回 Bot 对话'
      : viewNames[action.view];
type PrepareCourseAction = Extract<BotAction, { type: 'prepare-course' }>;
type PendingCourseSetup = {
  action: PrepareCourseAction;
  documents?: SessionDocumentSource[];
  actionRef?: { messageId: string; actionId: string };
};
type NativeGenerationState = {
  phase: 'preparing' | 'outline-ready' | 'review' | 'generating-content' | 'failed';
  outlines: SceneOutline[];
  isStreaming: boolean;
  isConfirming: boolean;
  statusMessage: string;
  error: string;
};
type BotFrameActions = {
  setSelectedCourse: (courseId: string) => void;
  setWorkspace: (value: BotThread['workspace']) => void;
  getWorkspaceMode: () => 'generation' | 'classroom' | undefined;
  updateTaskFromFrame: (
    taskId: string,
    threadId: string,
    messageId: string,
    actionId: string,
    status: 'running' | 'failed' | 'cancelled' | 'complete',
    details?: { error?: string; courseId?: string },
  ) => void;
};

export default function BotWorkspace() {
  const [threads, setThreads] = useState<BotThread[]>([]);
  const [knowledgeFolders, setKnowledgeFolders] = useState<BotKnowledgeFolder[]>([]);
  const [thread, setThread] = useState<BotThread>(makeThread);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingFolderId, setUploadingFolderId] = useState('');
  const [readingMaterials, setReadingMaterials] = useState(false);
  const [materialReadingStatus, setMaterialReadingStatus] = useState('');
  const [preparingCourseActionId, setPreparingCourseActionId] = useState('');
  const materials: BotMaterial[] = thread.materials ?? [];
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<Record<string, string | boolean> | null>(
    null,
  );
  const [lastRequestId, setLastRequestId] = useState('');
  const [downloadHistory, setDownloadHistory] = useState<
    Array<{ id: string; filename: string; completedAt: number }>
  >([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [courses, setCourses] = useState<StageListItem[]>([]);
  const [wideWorkspace, setWideWorkspace] = useState(false);
  const [pendingCourseSetup, setPendingCourseSetup] = useState<PendingCourseSetup | null>(null);
  const [nativeGeneration, setNativeGeneration] = useState<NativeGenerationState | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const selectedCourse = thread.selectedCourseId ?? '';
  const selectedKnowledgeFolderId = thread.selectedKnowledgeFolderId ?? '';
  const selectedKnowledgeFolder = knowledgeFolders.find(
    (folder) => folder.id === selectedKnowledgeFolderId,
  );
  const workspace = thread.workspace ?? null;
  const abort = useRef<AbortController | null>(null);
  const current = useRef(thread);
  const frame = useRef<HTMLIFrameElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const scrollThread = useRef(thread.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderFileInput = useRef<HTMLInputElement>(null);
  const folderUploadTarget = useRef<string | null>(null);
  const backupFileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const botFrameActions = useRef<BotFrameActions>({
    setSelectedCourse: () => {},
    setWorkspace: () => {},
    getWorkspaceMode: () => undefined,
    updateTaskFromFrame: () => {},
  });
  const pendingObjectUrls = useRef(new Map<string, { url: string; timeout: number }>());
  const executingActions = useRef(new Set<string>());
  const providerId = useSettingsStore((state) => state.providerId);
  const modelId = useSettingsStore((state) => state.modelId);

  const persist = useCallback(async (value: BotThread) => {
    if (
      value.messages.length === 0 &&
      !value.materials?.length &&
      !value.workspace &&
      !value.selectedCourseId &&
      !value.selectedKnowledgeFolderId
    )
      return;
    try {
      await saveBotThread(value);
      if (
        value.messages.length ||
        value.materials?.length ||
        value.workspace ||
        value.selectedCourseId ||
        value.selectedKnowledgeFolderId
      )
        setThreads((items) =>
          [value, ...items.filter((item) => item.id !== value.id)].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          ),
        );
      setStorageError('');
    } catch {
      setStorageError('对话尚未保存，请检查本机存储空间。可先下载对话备份。');
    }
  }, []);

  const updateThreadContext = (change: (value: BotThread) => BotThread) => {
    const next = { ...change(current.current), updatedAt: Date.now() };
    current.current = next;
    setThread(next);
  };
  const setSelectedCourse = (courseId: string) =>
    updateThreadContext((value) => ({ ...value, selectedCourseId: courseId || undefined }));
  const setSelectedKnowledgeFolder = (folderId: string) => {
    const value = folderId || undefined;
    updateThreadContext((currentValue) => ({
      ...currentValue,
      selectedKnowledgeFolderId: value,
    }));
    const next = { ...current.current, selectedKnowledgeFolderId: value, updatedAt: Date.now() };
    if (
      !value &&
      !next.messages.length &&
      !next.materials?.length &&
      !next.workspace &&
      !next.selectedCourseId
    ) {
      void deleteBotThread(next.id);
      setThreads((items) => items.filter((item) => item.id !== next.id));
    } else void persist(next);
  };
  const setWorkspace = (value: BotThread['workspace']) => {
    if (!value || value.mode !== 'generation') setNativeGeneration(null);
    updateThreadContext((threadValue) => ({ ...threadValue, workspace: value }));
  };

  useEffect(() => {
    const phase = nativeGeneration?.phase;
    if (workspace?.mode !== 'generation' || !phase || phase === 'review' || phase === 'failed') {
      return;
    }

    const limit = phase === 'preparing' ? 94 : phase === 'outline-ready' ? 97 : 99;
    const timer = window.setInterval(() => {
      setGenerationProgress((progress) => {
        if (progress >= limit) return limit;
        return Math.min(limit, progress + Math.max(0.35, (limit - progress) * 0.035));
      });
    }, 700);

    return () => window.clearInterval(timer);
  }, [nativeGeneration?.phase, workspace?.mode]);
  const setThreadMaterials = (value: BotMaterial[] | ((items: BotMaterial[]) => BotMaterial[])) => {
    const nextMaterials =
      typeof value === 'function' ? value(current.current.materials ?? []) : value;
    updateThreadContext((threadValue) => ({ ...threadValue, materials: nextMaterials }));
    void persist({ ...current.current, materials: nextMaterials, updatedAt: Date.now() });
  };

  const refreshCourses = useCallback(async () => {
    try {
      setCourses(await listStages());
    } catch {
      /* Existing workspace also reports storage health. */
    }
  }, []);

  useEffect(() => {
    let live = true;
    void listBotKnowledgeFolders()
      .then((items) => {
        if (live) setKnowledgeFolders(items);
      })
      .catch(() => {
        if (live) setStorageError('无法读取资料文件夹，请检查本机存储权限。');
      });
    void listBotThreads()
      .then((items) => {
        if (!live) return;
        setThreads(items);
        if (items.length) {
          setThread(items[0]);
          current.current = items[0];
        }
      })
      .catch(() => {
        if (live) setStorageError('无法读取对话记录，请检查本机存储权限。');
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    void refreshCourses();
    const focus = () => {
      void refreshCourses();
    };
    window.addEventListener('focus', focus);
    return () => {
      live = false;
      abort.current?.abort();
      window.removeEventListener('focus', focus);
    };
  }, [refreshCourses]);

  useEffect(() => {
    current.current = thread;
    if (!loaded || !thread.messages.length) return;
    const timer = setTimeout(() => {
      void persist(thread);
    }, 350);
    return () => clearTimeout(timer);
  }, [thread, loaded, persist]);

  useEffect(() => {
    const area = timeline.current;
    if (!area) return;
    if (scrollThread.current !== thread.id) {
      scrollThread.current = thread.id;
      followTail.current = true;
    }
    if (followTail.current) area.scrollTop = area.scrollHeight;
  }, [thread.id, thread.messages]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow)
        return;
      if (event.data?.type === 'ljkt-bot:return-to-chat') {
        botFrameActions.current.setWorkspace(null);
        setWideWorkspace(false);
        void refreshCourses();
        return;
      }
      if (event.data?.type === 'ljkt-bot:task-status') {
        if (
          typeof event.data.taskId === 'string' &&
          typeof event.data.threadId === 'string' &&
          typeof event.data.messageId === 'string' &&
          typeof event.data.actionId === 'string' &&
          ['running', 'failed', 'cancelled', 'complete'].includes(event.data.status)
        ) {
          if (typeof event.data.courseId === 'string')
            botFrameActions.current.setSelectedCourse(event.data.courseId);
          botFrameActions.current.updateTaskFromFrame(
            event.data.taskId,
            event.data.threadId,
            event.data.messageId,
            event.data.actionId,
            event.data.status,
            { error: typeof event.data.error === 'string' ? event.data.error : undefined },
          );
        }
        return;
      }
      if (event.data?.type === 'ljkt-bot:generation-state') {
        const phases = ['preparing', 'outline-ready', 'review', 'generating-content', 'failed'];
        if (!phases.includes(event.data.phase)) return;
        const outlines = Array.isArray(event.data.outlines)
          ? (event.data.outlines as SceneOutline[])
          : [];
        if (event.data.phase === 'review' && outlines.length > 0) setGenerationProgress(100);
        setNativeGeneration({
          phase: event.data.phase as NativeGenerationState['phase'],
          outlines,
          isStreaming: event.data.isStreaming === true,
          isConfirming: event.data.isConfirming === true,
          statusMessage:
            typeof event.data.statusMessage === 'string' ? event.data.statusMessage : '',
          error: typeof event.data.error === 'string' ? event.data.error : '',
        });
        return;
      }
      if (event.data?.type !== 'ljkt-bot:workspace-ready') return;
      if (typeof event.data.courseId === 'string')
        botFrameActions.current.setSelectedCourse(event.data.courseId);
      if (
        typeof event.data.botTaskId === 'string' &&
        typeof event.data.botThreadId === 'string' &&
        typeof event.data.botMessageId === 'string' &&
        typeof event.data.botActionId === 'string'
      ) {
        botFrameActions.current.updateTaskFromFrame(
          event.data.botTaskId,
          event.data.botThreadId,
          event.data.botMessageId,
          event.data.botActionId,
          'complete',
          { courseId: typeof event.data.courseId === 'string' ? event.data.courseId : undefined },
        );
      }
      if (botFrameActions.current.getWorkspaceMode() === 'generation') {
        setPendingCourseSetup(null);
        botFrameActions.current.setWorkspace(null);
        setWideWorkspace(false);
      }
      void refreshCourses();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [refreshCourses]);

  // The classroom's "return home" action is a client-side route transition,
  // so iframe onLoad does not fire. Poll same-origin navigation and close the
  // embedded workspace before the web teacher homepage can remain visible.
  useEffect(() => {
    if (!workspace) return;
    const closeIfAtBotHome = () => {
      try {
        const path = frame.current?.contentWindow?.location.pathname;
        if (path === '/' || path === '/bot') {
          botFrameActions.current.setWorkspace(null);
          setWideWorkspace(false);
          void refreshCourses();
        }
      } catch {
        // Only same-origin classroom navigation is inspected here.
      }
    };
    const timer = window.setInterval(closeIfAtBotHome, 300);
    closeIfAtBotHome();
    return () => window.clearInterval(timer);
  }, [workspace, refreshCourses]);

  const updateAssistant = (id: string, change: (message: BotMessage) => BotMessage) => {
    const value = current.current;
    const next = {
      ...value,
      updatedAt: Date.now(),
      messages: value.messages.map((message) => (message.id === id ? change(message) : message)),
    };
    current.current = next;
    setThread(next);
  };

  const updateAction = (
    messageId: string,
    actionId: string,
    change: (
      record: NonNullable<BotMessage['actions']>[number],
    ) => NonNullable<BotMessage['actions']>[number],
  ) => {
    const value = current.current;
    const next = {
      ...value,
      updatedAt: Date.now(),
      messages: value.messages.map((message) =>
        message.id !== messageId
          ? message
          : {
              ...message,
              actions: message.actions?.map((record) =>
                record.id === actionId ? change(record) : record,
              ),
            },
      ),
    };
    current.current = next;
    setThread(next);
    void persist(next);
  };

  const updateTaskFromFrame = (
    taskId: string,
    threadId: string,
    messageId: string,
    actionId: string,
    status: 'running' | 'failed' | 'cancelled' | 'complete',
    details: { error?: string; courseId?: string } = {},
  ) => {
    if (current.current.id !== threadId) return;
    updateAction(messageId, actionId, (record) => ({
      ...record,
      taskId,
      status,
      error: details.error,
      courseId: details.courseId ?? record.courseId,
      updatedAt: Date.now(),
    }));
  };
  botFrameActions.current = {
    setSelectedCourse,
    setWorkspace,
    getWorkspaceMode: () => current.current.workspace?.mode,
    updateTaskFromFrame,
  };

  const send = async () => {
    if (!draft.trim() || busy || uploading || preparingCourseActionId || !loaded) return;
    if (!hasUsableLLMProvider(useSettingsStore.getState().providersConfig)) {
      setSettingsOpen(true);
      setError('先配置一个文本模型，就可以开始对话。');
      return;
    }
    followTail.current = true;
    const prompt = draft.trim();
    const attachmentSnapshot: SessionDocumentSource[] = materials.map(toDocumentSource);
    const folderSnapshot = selectedKnowledgeFolder
      ? {
          id: selectedKnowledgeFolder.id,
          name: selectedKnowledgeFolder.name,
          materials: selectedKnowledgeFolder.materials.map(toDocumentSource),
        }
      : undefined;
    const assistantId = nanoid();
    const user: BotMessage = {
      id: nanoid(),
      role: 'user',
      content: prompt,
      materials: attachmentSnapshot,
      knowledgeFolder: folderSnapshot,
    };
    const assistant: BotMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      actions: [],
      status: 'streaming',
      materials: attachmentSnapshot,
      knowledgeFolder: folderSnapshot,
    };
    const next: BotThread = {
      ...thread,
      title: thread.messages.length ? thread.title : prompt.slice(0, 32),
      updatedAt: Date.now(),
      materials,
      messages: [...thread.messages, user, assistant],
    };
    setThread(next);
    current.current = next;
    setDraft('');
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    let finished = false;
    try {
      await persist(next);
      const config = getCurrentModelConfig();
      const contextWindow = config.contextWindow ?? 32768;
      const outputBudget = Math.min(
        config.outputWindow ?? 8192,
        8192,
        Math.floor(contextWindow * 0.2),
      );
      const inputBudget = Math.max(2500, Math.min(30000, contextWindow - outputBudget - 1500));
      const courseLimit = Math.max(20, Math.min(150, Math.floor(inputBudget / 100)));
      // Course context is conversation-scoped: only a course explicitly linked in this chat is
      // exposed to the model. The global course library remains available in the sidebar.
      const selectedCourses = selectedCourse
        ? selectCourseDirectory(
            courses.filter((course) => course.id === selectedCourse),
            prompt,
            selectedCourse,
            courseLimit,
          )
        : [];
      const needsMaterialExtraction = (item: BotMaterial) =>
        !item.extractedText || (item.extractionTruncated && item.extractedTextLength === undefined);
      const needsFolderIndex = Boolean(
        selectedKnowledgeFolder?.materials.some(needsMaterialExtraction),
      );
      setReadingMaterials(materials.some(needsMaterialExtraction) || needsFolderIndex);
      setMaterialReadingStatus(
        needsFolderIndex
          ? `正在本机准备“${selectedKnowledgeFolder?.name}”资料…`
          : '正在解析本对话中的教学材料…',
      );
      const parsedMaterials = await Promise.all(
        materials.map(async (material) => {
          if (!needsMaterialExtraction(material)) return material;
          if (/\.(txt|md|markdown|html|htm)$/i.test(material.name)) {
            const indexed = await indexKnowledgeMaterialLocally(material, controller.signal);
            return indexed.material;
          }
          const blob = await loadDocumentBlob(material.storageKey);
          if (!blob) throw new Error(`本机找不到材料《${material.name}》，请重新添加后再发送。`);
          const settings = useSettingsStore.getState();
          const providerId = settings.pdfProviderId;
          const providerConfig = settings.pdfProvidersConfig[providerId];
          const file = new File([blob], material.name, {
            type: material.mimeType || blob.type || 'application/octet-stream',
          });
          const formData = new FormData();
          formData.append('file', file);
          formData.append('providerId', providerId);
          formData.append('textOnly', 'true');
          if (providerConfig?.apiKey) formData.append('apiKey', providerConfig.apiKey);
          if (providerConfig?.baseUrl) formData.append('baseUrl', providerConfig.baseUrl);
          if (providerConfig?.accessKeyId)
            formData.append('accessKeyId', providerConfig.accessKeyId);
          if (providerConfig?.accessKeySecret)
            formData.append('accessKeySecret', providerConfig.accessKeySecret);
          const extractResponse = await fetch('/api/extract-document', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });
          const result = await extractResponse.json().catch(() => ({}));
          const text = typeof result?.data?.text === 'string' ? result.data.text.trim() : '';
          if (!extractResponse.ok || !text) {
            throw new Error(
              result?.error || `材料《${material.name}》没有提取到可用文字，请检查文档解析设置。`,
            );
          }
          return {
            ...material,
            extractedText: text.slice(0, MAX_BOT_MATERIAL_TEXT_CHARS),
            extractedTextLength: text.length,
            extractionTruncated: text.length > MAX_BOT_MATERIAL_TEXT_CHARS,
            extractedPageCount: Number(result?.data?.metadata?.pageCount) || undefined,
            extractionError: undefined,
          };
        }),
      );
      let folderMaterials: BotMaterial[] = [];
      let unsupportedFolderNames: string[] = [];
      if (selectedKnowledgeFolder?.materials.length) {
        setMaterialReadingStatus(`正在本机检索“${selectedKnowledgeFolder.name}”资料…`);
        const indexed = await indexKnowledgeFolderLocally(
          selectedKnowledgeFolder.materials,
          controller.signal,
          (finished, total) =>
            setMaterialReadingStatus(
              `正在本机检索“${selectedKnowledgeFolder.name}”资料（${finished}/${total}）…`,
            ),
        );
        folderMaterials = indexed.materials.filter((material) => Boolean(material.extractedText));
        unsupportedFolderNames = indexed.unsupportedNames;
        const updatedFolder = {
          ...selectedKnowledgeFolder,
          materials: indexed.materials,
          updatedAt: Date.now(),
        };
        await saveBotKnowledgeFolder(updatedFolder);
        setKnowledgeFolders((items) =>
          items.map((item) => (item.id === updatedFolder.id ? updatedFolder : item)),
        );
        if (!folderMaterials.length && !parsedMaterials.length) {
          throw new Error(
            `“${selectedKnowledgeFolder.name}”中没有可本机检索的 TXT、HTML 或 Markdown 文件。为保护原件，PDF、Word、PPTX 暂不上传解析；请转换为 TXT、HTML 或 Markdown 后再试。`,
          );
        }
        if (unsupportedFolderNames.length) {
          toast.warning(
            `以下资料暂不参与本机检索：${unsupportedFolderNames.slice(0, 4).join('、')}${unsupportedFolderNames.length > 4 ? '等' : ''}`,
          );
        }
      }
      const updatedThread = {
        ...current.current,
        materials: parsedMaterials,
        updatedAt: Date.now(),
      };
      current.current = updatedThread;
      setThread(updatedThread);
      await persist(updatedThread);
      setReadingMaterials(false);
      setMaterialReadingStatus('');
      const fixedContextTokens = 1500 + estimateTextTokens(JSON.stringify(selectedCourses));
      const latestPromptTokens = estimateTextTokens(prompt);
      if (fixedContextTokens + latestPromptTokens > inputBudget)
        throw new Error('这条消息已超过当前模型可用上下文，请缩短问题或改用上下文更大的模型。');
      const remainingContext = inputBudget - fixedContextTokens - latestPromptTokens;
      const selectedFolderMaterials = selectRelevantMaterials(
        folderMaterials,
        prompt,
        Math.min(6, Math.max(0, 12 - parsedMaterials.length)),
      );
      const contextMaterials = [...parsedMaterials, ...selectedFolderMaterials];
      const materialBudget = contextMaterials.length
        ? Math.min(7000, Math.floor(remainingContext * 0.38))
        : 0;
      const courseBudget = selectedCourse ? Math.min(4500, Math.floor(remainingContext * 0.24)) : 0;
      const materialContext = buildMaterialContext(contextMaterials, materialBudget, prompt);
      const folderNotice = unsupportedFolderNames.length
        ? `所选资料文件夹中有 ${unsupportedFolderNames.length} 份 PDF、Word、PPTX 或不可读文件，本机未解析这些原件。`
        : '';
      const scopedMaterialContext = [
        selectedKnowledgeFolder
          ? `本轮选用资料文件夹：${selectedKnowledgeFolder.name}。只将本机检索到的相关文本片段提供给模型。`
          : '',
        folderNotice,
        materialContext,
      ]
        .filter(Boolean)
        .join('\n\n');
      let courseContext: string | undefined;
      if (selectedCourse) {
        const saved = await loadStageData(selectedCourse);
        if (saved?.stage) {
          const source = extractCourseDocumentSource(saved.stage, saved.scenes);
          courseContext = buildCourseContext(source, prompt, courseBudget);
        }
      }
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-model': config.modelString,
        'x-api-key': config.apiKey,
        'x-base-url': config.baseUrl,
      };
      if (config.providerType) headers['x-provider-type'] = config.providerType;
      const routes = getStageRoutesHeaderValue();
      if (routes) headers['x-model-routes'] = routes;
      const conversation = next.messages
        .filter((message) => message.content.trim())
        .map(({ role, content }) => ({ role, content }));
      const latestMessage = conversation.at(-1);
      const history = latestMessage ? conversation.slice(0, -1) : conversation;
      const sourceTokens =
        estimateTextTokens(scopedMaterialContext) + estimateTextTokens(courseContext ?? '');
      const historyBudget = Math.max(
        0,
        inputBudget - fixedContextTokens - latestPromptTokens - sourceTokens,
      );
      const selectedHistory = selectRecentMessages(history, historyBudget);
      const messages = [...selectedHistory.messages, ...(latestMessage ? [latestMessage] : [])];
      const response = await fetch('/api/bot/chat', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          messages,
          courses: selectedCourses.map(({ id, name, sceneCount }) => ({ id, name, sceneCount })),
          courseContext,
          materialNames: contextMaterials.map((item) => item.name),
          materialContext: scopedMaterialContext || undefined,
          historyOmittedCount: selectedHistory.omittedCount,
          thinkingConfig: config.thinkingConfig,
        }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        if (typeof body.requestId === 'string') setLastRequestId(body.requestId);
        throw new Error(body.error || '模型没有返回有效响应，请检查模型配置。');
      }
      await readBotEvents(response.body, (event) => {
        if (event.type === 'text')
          updateAssistant(assistantId, (message) => ({
            ...message,
            content: message.content + event.text,
          }));
        if (event.type === 'action')
          updateAssistant(assistantId, (message) => ({
            ...message,
            actions: [
              ...(message.actions ?? []).filter((item) => item.id !== event.id),
              { id: event.id, action: event.action },
            ],
          }));
        if (event.type === 'error') {
          if (event.requestId) setLastRequestId(event.requestId);
          throw new Error(event.error);
        }
        if (event.type === 'done') finished = true;
      });
      if (!finished) throw new Error('连接已中断，可重新发送。');
      updateAssistant(assistantId, (message) => ({ ...message, status: 'complete' }));
    } catch (cause) {
      setReadingMaterials(false);
      setMaterialReadingStatus('');
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? '已停止回复。'
        : cause instanceof Error
          ? cause.message
          : '回复失败，请重试。';
      updateAssistant(assistantId, (value) => ({
        ...value,
        status: cancelled ? 'cancelled' : 'failed',
        error: message,
      }));
    } finally {
      setReadingMaterials(false);
      setMaterialReadingStatus('');
      abort.current = null;
      setBusy(false);
      await persist(current.current);
    }
  };

  const openCourseSetupFromMessage = async (
    message: BotMessage,
    action: PrepareCourseAction,
    actionRef: { messageId: string; actionId: string },
  ) => {
    if (preparingCourseActionId) return;
    const ownerThreadId = current.current.id;
    setPreparingCourseActionId(actionRef.actionId);
    let preparedAction = action;
    try {
      const reference = message.knowledgeFolder;
      if (reference?.materials.length) {
        setReadingMaterials(true);
        setMaterialReadingStatus(`正在本机检索“${reference.name}”中的任务相关资料…`);
        const liveFolder = await getBotKnowledgeFolder(reference.id);
        const cachedByKey = new Map(
          (liveFolder?.materials ?? []).map((material) => [material.storageKey, material]),
        );
        const sourceMaterials = reference.materials.map((source) => {
          const cached = cachedByKey.get(source.storageKey);
          return {
            ...source,
            extractedText: cached?.extractedText,
            extractedPageCount: cached?.extractedPageCount,
            extractedTextLength: cached?.extractedTextLength,
            extractionTruncated: cached?.extractionTruncated,
            extractionError: cached?.extractionError,
          } satisfies BotMaterial;
        });
        const query = `${action.title}\n${action.requirement}`;
        const indexed = await indexKnowledgeFolderLocally(
          sourceMaterials,
          new AbortController().signal,
          (finished, total) =>
            setMaterialReadingStatus(
              `正在本机检索“${reference.name}”中的任务相关资料（${finished}/${total}）…`,
            ),
        );
        if (liveFolder) {
          const indexedByKey = new Map(
            indexed.materials.map((material) => [material.storageKey, material]),
          );
          const updatedFolder = {
            ...liveFolder,
            materials: liveFolder.materials.map(
              (material) => indexedByKey.get(material.storageKey) ?? material,
            ),
            updatedAt: Date.now(),
          };
          await saveBotKnowledgeFolder(updatedFolder);
          setKnowledgeFolders((items) =>
            items.map((item) => (item.id === updatedFolder.id ? updatedFolder : item)),
          );
        }
        const readable = indexed.materials.filter((material) => Boolean(material.extractedText));
        const relevant = selectRelevantMaterials(readable, query, 5);
        const sectionLabel = `\n\n【资料文件夹“${reference.name}”的本机检索片段】\n`;
        const remainingChars = Math.max(
          0,
          19_999 - action.requirement.length - sectionLabel.length,
        );
        if (relevant.length && remainingChars >= 240) {
          const excerptContext = buildMaterialContext(
            relevant,
            Math.min(1800, Math.floor(remainingChars / 2)),
            query,
          );
          const excerpts = excerptContext.slice(0, remainingChars).trim();
          if (excerpts)
            preparedAction = {
              ...action,
              requirement: `${action.requirement}${sectionLabel}${excerpts}`,
            };
        }
        if (indexed.unsupportedNames.length) {
          toast.warning(
            `以下文件未参与本机检索：${indexed.unsupportedNames.slice(0, 4).join('、')}${indexed.unsupportedNames.length > 4 ? '等' : ''}`,
          );
        }
        if (!readable.length)
          toast.warning(
            '所选文件夹没有可读取的 TXT、HTML 或 Markdown；将按制作任务卡现有要求继续。',
          );
      }
      if (current.current.id !== ownerThreadId) return;
      setPendingCourseSetup({
        action: preparedAction,
        documents: message.materials,
        actionRef,
      });
      setWorkspace(null);
      setWideWorkspace(false);
    } catch (cause) {
      if (current.current.id === ownerThreadId)
        toast.error(cause instanceof Error ? cause.message : '资料读取失败，请重试。');
    } finally {
      setReadingMaterials(false);
      setMaterialReadingStatus('');
      if (current.current.id === ownerThreadId) setPreparingCourseActionId('');
    }
  };

  const execute = async (
    action: BotAction,
    documents?: SessionDocumentSource[],
    actionRef?: { messageId: string; actionId: string },
    setupOptions?: BotCourseSetupOptions,
  ) => {
    setError('');
    if (action.type === 'prepare-course') {
      if (actionRef && executingActions.current.has(actionRef.actionId)) return;
      if (actionRef) executingActions.current.add(actionRef.actionId);
      if (!hasUsableLLMProvider(useSettingsStore.getState().providersConfig)) {
        setSettingsOpen(true);
        if (actionRef) executingActions.current.delete(actionRef.actionId);
        return;
      }
      try {
        const settings = useSettingsStore.getState();
        const record = actionRef
          ? current.current.messages
              .find((message) => message.id === actionRef.messageId)
              ?.actions?.find((item) => item.id === actionRef.actionId)
          : undefined;
        if (record?.status === 'complete' && record.courseId) {
          setSelectedCourse(record.courseId);
          setWorkspace({
            url: actionPath({
              type: 'open-course',
              courseId: record.courseId,
              title: action.title,
              view: 'playback',
            }),
            title: action.title,
            mode: 'classroom',
          });
          return;
        }
        const taskId = record?.taskId || nanoid();
        let sessionId = record?.sessionId;
        let session = await loadBotTaskCheckpoint(taskId);
        if (session && session.threadId !== current.current.id) session = undefined;
        if (session?.courseId) {
          setSelectedCourse(session.courseId);
          const query = new URLSearchParams({ botEmbedded: '1', botTask: taskId });
          if (actionRef) {
            query.set('botThread', current.current.id);
            query.set('botMessage', actionRef.messageId);
            query.set('botActionId', actionRef.actionId);
          }
          setWorkspace({
            url: `/classroom/${encodeURIComponent(session.courseId)}?${query}`,
            title: action.title,
            mode: 'classroom',
          });
          return;
        }
        if (session) {
          sessionId = session.sessionId;
        } else {
          sessionId = sessionId || nanoid();
          const fresh = buildBotCourseSession(action, {
            sessionId,
            documents,
            webSearch: setupOptions?.webSearch ?? settings.webSearchEnabled,
            teacherAvatarPath: setupOptions?.teacherAvatarPath,
            learnerAvatarPath: setupOptions?.learnerAvatarPath,
            narratorVoice: setupOptions?.narratorVoice,
            userNickname: setupOptions?.userNickname,
            userBio: setupOptions?.userBio,
            pdfProviderId: settings.pdfProviderId,
            pdfProviderConfig: settings.pdfProvidersConfig?.[settings.pdfProviderId],
          });
          session = {
            id: taskId,
            threadId: current.current.id,
            actionId: actionRef?.actionId ?? '',
            sessionId,
            session: fresh,
            updatedAt: Date.now(),
          };
        }
        if (setupOptions && session) {
          session = {
            ...session,
            session: {
              ...session.session,
              teacherAvatarPath: setupOptions.teacherAvatarPath,
              learnerAvatarPath: setupOptions.learnerAvatarPath,
              narratorVoice: setupOptions.narratorVoice,
              requirements: {
                ...session.session.requirements,
                requirement: action.requirement,
                interactiveMode: action.interactive,
                teacherDemoMode: action.teacherDemo,
                webSearch: setupOptions.webSearch,
                ...(setupOptions.userNickname ? { userNickname: setupOptions.userNickname } : {}),
                ...(setupOptions.userBio ? { userBio: setupOptions.userBio } : {}),
              },
            },
          };
        }
        const savedPdfProviderId =
          session.session.pdfProviderId &&
          session.session.pdfProviderId in settings.pdfProvidersConfig
            ? (session.session.pdfProviderId as keyof typeof settings.pdfProvidersConfig)
            : settings.pdfProviderId;
        const restored = {
          ...session.session,
          pdfProviderConfig:
            session.session.pdfProviderConfig ?? settings.pdfProvidersConfig?.[savedPdfProviderId],
        };
        await saveBotTaskCheckpoint({
          ...session,
          threadId: current.current.id,
          actionId: actionRef?.actionId ?? session.actionId,
          session: restored,
          updatedAt: Date.now(),
        });
        if (actionRef) {
          updateAction(actionRef.messageId, actionRef.actionId, (item) => ({
            ...item,
            status: 'running',
            taskId,
            sessionId,
            error: undefined,
            updatedAt: Date.now(),
          }));
        }
        sessionStorage.setItem(generationSessionKey(sessionId), JSON.stringify(restored));
        const query = new URLSearchParams({ botSession: sessionId, botTask: taskId });
        if (actionRef) {
          query.set('botThread', current.current.id);
          query.set('botMessage', actionRef.messageId);
          query.set('botActionId', actionRef.actionId);
        }
        setPendingCourseSetup(null);
        setGenerationProgress(3);
        setNativeGeneration({
          phase: 'preparing',
          outlines: [],
          isStreaming: false,
          isConfirming: false,
          statusMessage: '正在准备大纲…',
          error: '',
        });
        setWorkspace({
          url: `/generation-preview?${query}&botNative=1`,
          title: action.title,
          mode: 'generation',
        });
      } catch {
        if (actionRef)
          updateAction(actionRef.messageId, actionRef.actionId, (item) => ({
            ...item,
            status: 'failed',
            error: '任务未能保存，请检查本机存储后重试。',
            updatedAt: Date.now(),
          }));
        setError('无法准备制作任务，请检查本机存储后重试。');
      } finally {
        if (actionRef) executingActions.current.delete(actionRef.actionId);
      }
    } else if (action.type === 'open-course') {
      setPendingCourseSetup(null);
      setSelectedCourse(action.courseId);
      setWorkspace({ url: actionPath(action), title: action.title, mode: 'classroom' });
    } else {
      setWorkspace(null);
      setWideWorkspace(false);
      void refreshCourses();
    }
  };

  const createKnowledgeFolder = async () => {
    const name = window.prompt('新建资料文件夹名称');
    if (!name?.trim()) return;
    const normalizedName = name.trim().slice(0, 60);
    if (
      knowledgeFolders.some((folder) => folder.name.toLowerCase() === normalizedName.toLowerCase())
    ) {
      toast.error('已有同名资料文件夹。');
      return;
    }
    const now = Date.now();
    const folder: BotKnowledgeFolder = {
      id: nanoid(),
      name: normalizedName,
      createdAt: now,
      updatedAt: now,
      materials: [],
    };
    try {
      await saveBotKnowledgeFolder(folder);
      setKnowledgeFolders((items) => [folder, ...items]);
      setSelectedKnowledgeFolder(folder.id);
      toast.success(`已创建资料文件夹“${folder.name}”。`);
    } catch {
      setError('资料文件夹未能保存，请检查本机存储空间。');
    }
  };

  const renameKnowledgeFolder = async (folder: BotKnowledgeFolder) => {
    const name = window.prompt('重命名资料文件夹', folder.name);
    if (!name?.trim()) return;
    const normalizedName = name.trim().slice(0, 60);
    if (
      knowledgeFolders.some(
        (item) => item.id !== folder.id && item.name.toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      toast.error('已有同名资料文件夹。');
      return;
    }
    const updated = { ...folder, name: normalizedName, updatedAt: Date.now() };
    try {
      await saveBotKnowledgeFolder(updated);
      setKnowledgeFolders((items) =>
        [updated, ...items.filter((item) => item.id !== updated.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      );
    } catch {
      setError('资料文件夹未能重命名，请重试。');
    }
  };

  const removeKnowledgeFolder = async (folder: BotKnowledgeFolder) => {
    if (!window.confirm(`删除资料文件夹“${folder.name}”？已发送到对话的任务仍保留其资料引用。`))
      return;
    try {
      const referencedKeys = new Set<string>();
      const allThreads = [
        ...threads.filter((item) => item.id !== current.current.id),
        current.current,
      ];
      for (const item of allThreads) {
        for (const material of item.materials ?? []) referencedKeys.add(material.storageKey);
        for (const message of item.messages) {
          for (const material of message.materials ?? []) referencedKeys.add(material.storageKey);
          for (const material of message.knowledgeFolder?.materials ?? [])
            referencedKeys.add(material.storageKey);
        }
      }
      for (const other of knowledgeFolders)
        if (other.id !== folder.id)
          for (const material of other.materials) referencedKeys.add(material.storageKey);
      await deleteBotKnowledgeFolder(folder.id);
      setKnowledgeFolders((items) => items.filter((item) => item.id !== folder.id));
      await Promise.allSettled(
        folder.materials
          .filter((material) => !referencedKeys.has(material.storageKey))
          .map((material) => deleteDocumentBlob(material.storageKey)),
      );
      if (selectedKnowledgeFolderId === folder.id) setSelectedKnowledgeFolder('');
      toast.success('资料文件夹已删除。');
    } catch {
      setError('资料文件夹未能删除，请重试。');
    }
  };

  const uploadToKnowledgeFolder = async (folderId: string, files: FileList | null) => {
    if (!files?.length || uploadingFolderId) return;
    const folder = knowledgeFolders.find((item) => item.id === folderId);
    if (!folder) return;
    const additions = Array.from(files);
    const size = folder.materials.reduce((total, item) => total + item.size, 0);
    if (
      folder.materials.length + additions.length > MAX_KNOWLEDGE_FOLDER_FILES ||
      additions.some((file) => file.size > 50 * 1024 * 1024) ||
      size + additions.reduce((total, file) => total + file.size, 0) > MAX_KNOWLEDGE_FOLDER_BYTES
    ) {
      setError('每个资料文件夹最多30份文件、总计200MB，单份不超过50MB。');
      return;
    }
    if (additions.some((file) => !/\.(pdf|pptx|docx|txt|md|html|htm)$/i.test(file.name))) {
      setError('支持 PDF、PPTX、Word、TXT、Markdown 和 HTML 教学材料。');
      return;
    }
    setUploadingFolderId(folderId);
    setError('');
    const createdKeys: string[] = [];
    try {
      const records: BotMaterial[] = [];
      for (const file of additions) {
        const storageKey = await storeDocumentBlob(file);
        createdKeys.push(storageKey);
        records.push({
          id: nanoid(),
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          mimeType: normalizeDocumentMimeType({ mimeType: file.type, fileName: file.name }),
          order: folder.materials.length + records.length + 1,
          storageKey,
          providerId: useSettingsStore.getState().pdfProviderId,
        });
      }
      const updated = {
        ...folder,
        materials: [...folder.materials, ...records],
        updatedAt: Date.now(),
      };
      await saveBotKnowledgeFolder(updated);
      setKnowledgeFolders((items) =>
        [updated, ...items.filter((item) => item.id !== updated.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      );
      toast.success(`已将 ${records.length} 份资料加入“${folder.name}”。`);
    } catch (cause) {
      await Promise.allSettled(createdKeys.map((key) => deleteDocumentBlob(key)));
      setError(cause instanceof Error ? cause.message : '资料未能保存，请重试。');
    } finally {
      setUploadingFolderId('');
      if (folderFileInput.current) folderFileInput.current.value = '';
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || uploading) return;
    const additions = Array.from(files);
    if (
      materials.length + additions.length > 8 ||
      additions.some((file) => file.size > 50 * 1024 * 1024)
    ) {
      setError('单次最多8份材料，每份不超过50MB。请分批添加。');
      return;
    }
    if (additions.some((file) => !/\.(pdf|pptx|docx|txt|md|html|htm)$/i.test(file.name))) {
      setError('支持 PDF、PPTX、Word、TXT、Markdown 和 HTML 教学材料。');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const records: BotMaterial[] = [];
      for (const file of additions)
        records.push({
          id: nanoid(),
          name: file.name,
          size: file.size,
          mimeType: normalizeDocumentMimeType({ mimeType: file.type, fileName: file.name }),
          order: materials.length + records.length + 1,
          storageKey: await storeDocumentBlob(file),
          providerId: useSettingsStore.getState().pdfProviderId,
          extractionError: undefined,
        });
      setThreadMaterials((items) => [...items, ...records]);
    } catch {
      setError('材料未能保存，请重试。');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const newChat = async (value?: BotThread) => {
    if (busy) return;
    await persist(current.current);
    const next = value ?? makeThread();
    setThread(next);
    current.current = next;
    setWideWorkspace(false);
    setDraft('');
    setError('');
    if (window.innerWidth < 800) setSidebarOpen(false);
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void newChat();
      }
    };
    window.addEventListener('keydown', shortcut);
    const bridge = (
      window as typeof window & {
        ljktDesktop?: {
          onNewChat(callback: () => void): () => void;
          onDownloadFinished(
            callback: (download: {
              sourceUrl: string;
              completed: boolean;
              id?: string;
              filename?: string;
            }) => void,
          ): () => void;
          openDownloadedItem(id: string): Promise<boolean>;
          listDownloads(): Promise<Array<{ id: string; filename: string; completedAt: number }>>;
        };
      }
    ).ljktDesktop;
    void bridge
      ?.listDownloads()
      .then(setDownloadHistory)
      .catch(() => {});
    const off = bridge?.onNewChat(() => {
      void newChat();
    });
    const offDownloads = bridge?.onDownloadFinished(({ sourceUrl, completed, id, filename }) => {
      const pending = pendingObjectUrls.current.get(sourceUrl);
      if (pending) {
        window.clearTimeout(pending.timeout);
        URL.revokeObjectURL(pending.url);
        pendingObjectUrls.current.delete(sourceUrl);
      }
      if (!completed || !id || !filename) return;
      void bridge
        ?.listDownloads()
        .then(setDownloadHistory)
        .catch(() => {});
      toast.success(`${filename} 已下载`, {
        duration: 15000,
        action: {
          label: '打开所在位置',
          onClick: () => {
            void bridge.openDownloadedItem(id).catch(() => {
              toast.error('无法打开下载文件所在位置，文件可能已被移动或删除。');
            });
          },
        },
      });
    });
    return () => {
      window.removeEventListener('keydown', shortcut);
      off?.();
      offDownloads?.();
    };
  });

  useEffect(
    () => () => {
      for (const pending of pendingObjectUrls.current.values()) {
        window.clearTimeout(pending.timeout);
        URL.revokeObjectURL(pending.url);
      }
      pendingObjectUrls.current.clear();
    },
    [],
  );

  const runDiagnostics = async () => {
    setDiagnosticsOpen(true);
    const settings = useSettingsStore.getState();
    const config = getCurrentModelConfig();
    let localService = '未能连接';
    let localInstance = '';
    try {
      const response = await fetch('/api/bot/health', { cache: 'no-store' });
      const payload = await response.json();
      localService = response.ok ? '正常' : `HTTP ${response.status}`;
      localInstance = typeof payload.instance === 'string' ? payload.instance : '';
    } catch {
      localService = '无法连接';
    }
    const bridge = (
      window as typeof window & {
        ljktDesktop?: {
          info(): Promise<{ version: string; platform: string; dataDirectory: string }>;
        };
      }
    ).ljktDesktop;
    let desktop = '网页模式或桌面桥接不可用';
    if (bridge) {
      try {
        const info = await bridge.info();
        desktop = `${info.version} · ${info.platform} · ${info.dataDirectory}`;
      } catch {
        desktop = '桌面桥接调用失败';
      }
    }
    let modelHost = '未配置';
    try {
      modelHost = config.baseUrl ? new URL(config.baseUrl).host : '未设置 Base URL';
    } catch {
      modelHost = 'Base URL 格式无效';
    }
    setDiagnosticReport({
      checkedAt: new Date().toLocaleString(),
      browserOnline: navigator.onLine,
      localService,
      localInstance,
      desktop,
      model: `${config.providerId}:${config.modelId}`,
      modelKeyConfigured: Boolean(config.apiKey || config.isServerConfigured),
      modelHost,
      lastRequestId: lastRequestId || '暂无',
      pdfParser: settings.pdfProviderId,
      pdfParserKeyConfigured: Boolean(
        settings.pdfProvidersConfig[settings.pdfProviderId]?.apiKey ||
        settings.pdfProvidersConfig[settings.pdfProviderId]?.isServerConfigured,
      ),
    });
  };

  const copyDiagnostics = async () => {
    if (!diagnosticReport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticReport, null, 2));
      toast.success('已复制脱敏诊断信息。');
    } catch {
      toast.error('无法访问剪贴板，请手动复制诊断信息。');
    }
  };

  const downloadChat = () => {
    const blob = new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const timeout = window.setTimeout(
      () => {
        URL.revokeObjectURL(url);
        pendingObjectUrls.current.delete(url);
      },
      15 * 60 * 1000,
    );
    pendingObjectUrls.current.set(url, { url, timeout });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${thread.title.replace(/[\\/:*?"<>|]/g, '_')}.json`;
    a.click();
  };
  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const timeout = window.setTimeout(
      () => {
        URL.revokeObjectURL(url);
        pendingObjectUrls.current.delete(url);
      },
      15 * 60 * 1000,
    );
    pendingObjectUrls.current.set(url, { url, timeout });
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  };

  const downloadFullBackup = async () => {
    try {
      const backup = await createBotBackup(current.current);
      const safeTitle = current.current.title.replace(/[\\/:*?"<>|]/g, '_') || '灵境课堂对话';
      downloadBlob(backup, `${safeTitle}.ljbot.zip`);
      toast.info('完整备份已交给系统下载；桌面端保存完成后会显示“打开所在位置”。');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '无法创建完整备份。');
    }
  };

  const importFullBackup = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!window.confirm('恢复备份会覆盖本机同编号的对话，并写入其中的附件和制作任务。是否继续？'))
      return;
    setUploading(true);
    try {
      const restored = await restoreBotBackup(file);
      const previous = threads.find((item) => item.id === restored.thread.id);
      await saveBotThread(restored.thread);
      if (previous) {
        const oldTasks = await listBotTaskCheckpoints(previous.id);
        await Promise.allSettled(oldTasks.map((task) => deleteBotTaskCheckpoint(task.id)));
        await Promise.allSettled(
          Array.from(
            new Set([
              ...(previous.materials ?? []).map((material) => material.storageKey),
              ...previous.messages.flatMap((message) =>
                (message.materials ?? []).map((material) => material.storageKey),
              ),
            ]),
          ).map((storageKey) => deleteDocumentBlob(storageKey)),
        );
      }
      await saveRestoredBotTasks(restored.tasks);
      const nextThreads = await listBotThreads();
      setThreads(nextThreads);
      setThread(restored.thread);
      current.current = restored.thread;
      setWideWorkspace(false);
      toast.success(
        `对话已恢复，包含 ${restored.thread.materials?.length ?? 0} 份资料和 ${restored.tasks.length} 个制作检查点。`,
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '备份无法恢复。');
    } finally {
      setUploading(false);
      if (backupFileInput.current) backupFileInput.current.value = '';
    }
  };

  return (
    <main
      className={`ljbot ${sidebarOpen ? '' : 'ljbot-nav-hidden'} ${workspace || pendingCourseSetup ? 'ljbot-has-workspace' : ''} ${pendingCourseSetup ? 'ljbot-setup-open' : ''} ${wideWorkspace ? 'ljbot-workspace-wide' : ''}`}
    >
      <aside className="ljbot-sidebar" aria-label="主导航">
        <div className="ljbot-brand">
          <img src="/lingjing-mark.png" alt="灵境课堂" />
          <div>
            <strong>灵境课堂</strong>
            <span>Bot · 教师创作助手</span>
          </div>
          <button title="收起侧栏" onClick={() => setSidebarOpen(false)}>
            <PanelLeftClose size={17} />
          </button>
        </div>
        <button className="ljbot-new" onClick={() => void newChat()} disabled={busy || !loaded}>
          <Plus size={18} />
          新建对话<span>⌘ N</span>
        </button>
        <button className="ljbot-nav" onClick={() => setLibraryOpen(true)}>
          <LayoutPanelLeft size={18} />
          我的课件
          <ChevronRight size={14} />
        </button>
        <div className="ljbot-section">最近对话</div>
        <div className="ljbot-history">
          {!loaded && <span className="ljbot-muted">正在读取…</span>}
          {loaded && !threads.length && <span className="ljbot-muted">从第一个教学想法开始</span>}
          {threads.map((item) => (
            <div
              className={`ljbot-history-item ${item.id === thread.id ? 'active' : ''}`}
              key={item.id}
            >
              <button disabled={busy} onClick={() => void newChat(item)}>
                <MessageSquare size={15} />
                <span>{item.title}</span>
              </button>
              <button
                aria-label={`删除对话 ${item.title}`}
                disabled={busy}
                onClick={async () => {
                  try {
                    await deleteBotThread(item.id);
                    await Promise.allSettled(
                      Array.from(
                        new Set([
                          ...(item.materials ?? []).map((material) => material.storageKey),
                          ...item.messages.flatMap((message) =>
                            (message.materials ?? []).map((material) => material.storageKey),
                          ),
                        ]),
                      ).map((storageKey) => deleteDocumentBlob(storageKey)),
                    );
                    setThreads((items) => items.filter((value) => value.id !== item.id));
                    if (item.id === thread.id) {
                      const empty = makeThread();
                      setThread(empty);
                      current.current = empty;
                    }
                  } catch {
                    setError('删除失败，请重试。');
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="ljbot-section ljbot-folder-heading">
          资料文件夹
          <button
            title="新建资料文件夹"
            onClick={() => void createKnowledgeFolder()}
            disabled={!loaded || busy || uploadingFolderId !== ''}
          >
            <FolderPlus size={15} />
          </button>
        </div>
        <div className="ljbot-folder-help">
          本机检索支持 TXT、HTML、Markdown；PDF、Word、PPTX 暂保存在本地，不会自动上传解析。
        </div>
        <input
          ref={folderFileInput}
          type="file"
          hidden
          multiple
          accept=".pdf,.pptx,.docx,.txt,.md,.html,.htm"
          onChange={(event) =>
            void uploadToKnowledgeFolder(folderUploadTarget.current ?? '', event.target.files)
          }
        />
        <div className="ljbot-folder-list">
          {!knowledgeFolders.length && (
            <span className="ljbot-muted">按主题整理资料，供对话和课件任务使用</span>
          )}
          {knowledgeFolders.map((folder) => (
            <div className="ljbot-folder-item" key={folder.id}>
              <button
                className={folder.id === selectedKnowledgeFolderId ? 'active' : ''}
                title={`选择“${folder.name}”作为当前对话资料范围`}
                aria-pressed={folder.id === selectedKnowledgeFolderId}
                disabled={busy}
                onClick={() =>
                  setSelectedKnowledgeFolder(
                    folder.id === selectedKnowledgeFolderId ? '' : folder.id,
                  )
                }
              >
                <FolderOpen size={14} />
                <span>{folder.name}</span>
                <small>{folder.materials.length}</small>
              </button>
              <button
                title={`向“${folder.name}”添加资料`}
                disabled={busy || uploadingFolderId !== ''}
                onClick={() => {
                  folderUploadTarget.current = folder.id;
                  folderFileInput.current?.click();
                }}
              >
                {uploadingFolderId === folder.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <FilePlus2 size={13} />
                )}
              </button>
              <button
                title={`重命名“${folder.name}”`}
                disabled={busy || uploadingFolderId !== ''}
                onClick={() => void renameKnowledgeFolder(folder)}
              >
                <Pencil size={12} />
              </button>
              <button
                title={`删除“${folder.name}”`}
                disabled={busy || uploadingFolderId !== ''}
                onClick={() => void removeKnowledgeFolder(folder)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="ljbot-section ljbot-course-heading">
          我的课件
          <button title="刷新课件" onClick={() => void refreshCourses()}>
            <BookOpen size={14} />
          </button>
        </div>
        <div className="ljbot-courses">
          {courses.slice(0, 12).map((course) => (
            <button
              key={course.id}
              title={course.name}
              onClick={() =>
                void execute({
                  type: 'open-course',
                  courseId: course.id,
                  title: course.name,
                  view: 'playback',
                })
              }
            >
              <FileText size={15} />
              <span>{course.name}</span>
              <small>{course.sceneCount}页</small>
            </button>
          ))}
          {!courses.length && <span className="ljbot-muted">制作或导入后会显示在这里</span>}
        </div>
        <div className="ljbot-sidebar-foot">
          <button onClick={() => setSettingsOpen(true)}>
            <Settings size={17} />
            模型与设置
          </button>
          <span>老师主导教学，AI 辅助备课</span>
        </div>
      </aside>

      <section className="ljbot-conversation" aria-label="教学对话">
        <header className="ljbot-topbar">
          <div>
            {!sidebarOpen && (
              <button title="展开侧栏" onClick={() => setSidebarOpen(true)}>
                <PanelLeftOpen size={19} />
              </button>
            )}
            <span>灵境 Bot</span>
            <small>独立桌面版</small>
          </div>
          <div className="ljbot-topbar-actions">
            <input
              ref={backupFileInput}
              type="file"
              hidden
              accept=".zip,.ljbot.zip"
              onChange={(event) => void importFullBackup(event.target.files?.[0])}
            />
            <button title="连接诊断" onClick={() => void runDiagnostics()}>
              <Activity size={16} />
            </button>
            <button title="下载记录" onClick={() => setDownloadsOpen(true)}>
              <FolderOpen size={16} />
            </button>
            <button
              title="导出完整备份（含附件和制作任务）"
              onClick={() => void downloadFullBackup()}
              disabled={!thread.messages.length && !materials.length}
            >
              <Archive size={16} />
            </button>
            <button
              title="恢复完整备份"
              onClick={() => backupFileInput.current?.click()}
              disabled={busy || uploading}
            >
              <Upload size={16} />
            </button>
            <button
              title="下载当前对话 JSON"
              onClick={downloadChat}
              disabled={!thread.messages.length}
            >
              <Download size={17} />
            </button>
          </div>
        </header>
        <div
          ref={timeline}
          onScroll={() => {
            const area = timeline.current;
            if (area)
              followTail.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
          }}
          className={`ljbot-timeline ${thread.messages.length ? '' : 'ljbot-empty'}`}
        >
          {!thread.messages.length ? (
            <div className="ljbot-welcome">
              <div className="ljbot-welcome-mark">
                <img src="/lingjing-mark.png" alt="幻彩书页徽标" />
              </div>
              <div className="ljbot-eyebrow">从一个教学想法开始</div>
              <h1>
                今天，想把什么
                <br />
                带进课堂？
              </h1>
              <p>
                聊知识，理思路，把想法变成可以修改、
                <br className="ljbot-desktop-break" />
                可以讲授的课件。
              </p>
              <div className="ljbot-suggestions">
                {[
                  '制作一节勾股定理互动课',
                  '帮我梳理本节课的教学思路',
                  '根据已有课件整理课堂笔记',
                ].map((value) => (
                  <button
                    key={value}
                    onClick={() => {
                      setDraft(value);
                      textarea.current?.focus();
                    }}
                  >
                    {value}
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ljbot-message-list">
              {thread.messages.map((message) => (
                <article className={`ljbot-message ljbot-message-${message.role}`} key={message.id}>
                  {message.role === 'assistant' && (
                    <div className="ljbot-assistant-icon">
                      <img src="/lingjing-mark.png" alt="灵境 Bot" />
                    </div>
                  )}
                  <div className="ljbot-message-body">
                    {message.content &&
                      (message.role === 'assistant' ? (
                        <Streamdown
                          plugins={math}
                          parseIncompleteMarkdown={message.status === 'streaming'}
                        >
                          {message.content}
                        </Streamdown>
                      ) : (
                        <p>{message.content}</p>
                      ))}
                    {message.role === 'user' && !!message.materials?.length && (
                      <div className="ljbot-message-files">
                        {message.materials.map((item) => (
                          <span key={item.id}>
                            <Paperclip size={13} />
                            {item.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.role === 'user' && message.knowledgeFolder && (
                      <div className="ljbot-message-files">
                        <span>
                          <FolderOpen size={13} />
                          资料文件夹：{message.knowledgeFolder.name} ·{' '}
                          {message.knowledgeFolder.materials.length} 份
                        </span>
                      </div>
                    )}
                    {message.status === 'streaming' &&
                      !message.content &&
                      !message.actions?.length && (
                        <div className="ljbot-thinking">
                          <span />
                          <span />
                          <span />
                        </div>
                      )}
                    {message.actions?.map((record) => {
                      const { id, action } = record;
                      const activeTask = Boolean(
                        record.taskId && workspace?.url.includes(`botTask=${record.taskId}`),
                      );
                      const taskLabel =
                        record.status === 'complete'
                          ? '打开已生成课件'
                          : record.status === 'running'
                            ? activeTask
                              ? '任务进行中'
                              : '继续制作任务'
                            : record.status === 'failed' || record.status === 'cancelled'
                              ? '重试制作任务'
                              : actionLabel(action);
                      return (
                        <div className="ljbot-task-card" key={id}>
                          <div>
                            <BookOpen size={19} />
                            <div>
                              <strong>
                                {action.type === 'open-workspace' ? 'Bot 对话' : action.title}
                              </strong>
                              <p>
                                {record.status === 'running'
                                  ? '任务已保存；可在原对话中继续审阅或恢复。'
                                  : record.status === 'failed'
                                    ? record.error || '上次任务未完成，可重试。'
                                    : record.status === 'complete'
                                      ? '课件已生成并关联到此任务。'
                                      : action.type === 'prepare-course'
                                        ? '先审阅大纲，再制作课件'
                                        : action.type === 'open-workspace'
                                          ? '已保存课件可从左侧“我的课件”打开'
                                          : '基于当前保存的课件继续操作'}
                              </p>
                            </div>
                          </div>
                          <button
                            disabled={activeTask || preparingCourseActionId === id}
                            onClick={() =>
                              action.type === 'prepare-course' &&
                              record.status !== 'running' &&
                              record.status !== 'complete'
                                ? void openCourseSetupFromMessage(message, action, {
                                    messageId: message.id,
                                    actionId: id,
                                  })
                                : void execute(action, message.materials, {
                                    messageId: message.id,
                                    actionId: id,
                                  })
                            }
                          >
                            {preparingCourseActionId === id ? '正在本机检索资料…' : taskLabel}
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      );
                    })}
                    {message.error && (
                      <div role="status" className="ljbot-inline-error">
                        {message.error}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div className="ljbot-composer-area">
          {(error || storageError) && (
            <div className="ljbot-error" role="alert">
              {storageError || error}
              <button
                title="关闭提示"
                onClick={() => {
                  setError('');
                  setStorageError('');
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <form
            className="ljbot-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {readingMaterials && (
              <div className="ljbot-material-reading">
                {materialReadingStatus || '正在解析教学材料…'}
              </div>
            )}
            {!!materials.length && (
              <div className="ljbot-attachments">
                <span className="ljbot-material-label">本对话资料</span>
                {materials.map((item) => (
                  <span
                    key={item.id}
                    title={
                      item.extractionError ||
                      (item.extractedText
                        ? item.extractionTruncated
                          ? '已保存可检索正文片段；原始附件会在大纲和课件生成时重新解析'
                          : '已保存全文提取文本；Bot 会按问题检索相关段落'
                        : '发送时自动解析原始附件')
                    }
                  >
                    <FileText size={13} />
                    {item.name}
                    {item.extractedText
                      ? item.extractionTruncated
                        ? ' · 部分已索引'
                        : ' · 全文已索引'
                      : ''}
                    <button
                      type="button"
                      title={`移除 ${item.name}`}
                      onClick={() => {
                        setThreadMaterials((items) =>
                          items.filter((value) => value.id !== item.id),
                        );
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textarea}
              value={draft}
              maxLength={20000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="提一个问题，或描述你想制作的课程…"
              aria-label="发送给灵境 Bot"
              rows={2}
            />
            <div className="ljbot-composer-tools">
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  multiple
                  accept=".pdf,.pptx,.docx,.txt,.md,.html,.htm"
                  onChange={(event) => void upload(event.target.files)}
                />
                <button
                  type="button"
                  title="添加教学材料"
                  disabled={uploading || busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Paperclip size={17} />
                  )}
                </button>
                <button type="button" className="ljbot-model" onClick={() => setSettingsOpen(true)}>
                  {modelId || providerId || '配置模型'}
                  <ChevronRight size={12} />
                </button>
              </div>
              <div>
                <select
                  className="ljbot-folder-select"
                  aria-label="本对话资料文件夹"
                  title="选择本对话可使用的资料文件夹"
                  value={selectedKnowledgeFolderId}
                  onChange={(event) => setSelectedKnowledgeFolder(event.target.value)}
                  disabled={busy || !knowledgeFolders.length}
                >
                  <option value="">资料文件夹</option>
                  {knowledgeFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}（{folder.materials.length}份）
                    </option>
                  ))}
                </select>
                <select
                  aria-label="关联课件"
                  value={selectedCourse}
                  onFocus={() => void refreshCourses()}
                  onChange={(event) => setSelectedCourse(event.target.value)}
                >
                  <option value="">关联课件</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
                {busy ? (
                  <button
                    type="button"
                    className="ljbot-send"
                    title="停止回复"
                    onClick={() => abort.current?.abort()}
                  >
                    <Square size={15} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="ljbot-send"
                    title="发送"
                    type="submit"
                    disabled={
                      !draft.trim() || uploading || !loaded || Boolean(preparingCourseActionId)
                    }
                  >
                    <ArrowUp size={20} />
                  </button>
                )}
              </div>
            </div>
          </form>
          <div className="ljbot-composer-note">
            Enter 发送 · Shift Enter 换行 · 课件内容可在专业模式中继续调整
          </div>
        </div>
      </section>

      {pendingCourseSetup && (
        <section className="ljbot-workspace ljbot-native-setup" aria-label="Bot 课件制作设置">
          <header>
            <div>
              <BookOpen size={16} />
              <strong>Bot 课件制作</strong>
            </div>
            <button title="返回对话" onClick={() => setPendingCourseSetup(null)}>
              <X size={17} />
            </button>
          </header>
          <BotCourseSetup
            action={pendingCourseSetup.action}
            onCancel={() => setPendingCourseSetup(null)}
            onOpenSettings={() => setSettingsOpen(true)}
            onStart={(action, options) =>
              void execute(
                action,
                pendingCourseSetup.documents,
                pendingCourseSetup.actionRef,
                options,
              )
            }
          />
        </section>
      )}

      {workspace && (
        <section className="ljbot-workspace" aria-label="课件预览和编辑">
          <header>
            <div>
              <LayoutPanelLeft size={16} />
              <strong>{workspace.title}</strong>
            </div>
            <div>
              <button
                title={wideWorkspace ? '恢复并排' : '展开工作区'}
                onClick={() => setWideWorkspace((value) => !value)}
              >
                <Maximize2 size={15} />
              </button>
              <button
                title="关闭工作区"
                onClick={() => {
                  if (workspace.mode === 'generation') {
                    frame.current?.contentWindow?.postMessage(
                      { type: 'ljkt-bot:generation-cancel' },
                      window.location.origin,
                    );
                  } else {
                    setWorkspace(null);
                    setWideWorkspace(false);
                    void refreshCourses();
                  }
                }}
              >
                <X size={17} />
              </button>
            </div>
          </header>
          {workspace.mode === 'generation' ? (
            <div className="ljbot-native-generation">
              <div className="ljbot-generation-status">
                <div className="ljbot-generation-spinner">
                  {nativeGeneration?.phase === 'failed' ? <X size={18} /> : <Loader2 size={18} />}
                </div>
                <div>
                  <strong>
                    {nativeGeneration?.phase === 'review'
                      ? '审阅课程大纲'
                      : nativeGeneration?.phase === 'generating-content'
                        ? '正在生成课件'
                        : nativeGeneration?.phase === 'failed'
                          ? '制作遇到问题'
                          : '正在整理大纲'}
                  </strong>
                  <p>
                    {nativeGeneration?.phase === 'review'
                      ? '可调整章节顺序、内容和互动类型，确认后开始生成课件。'
                      : nativeGeneration?.statusMessage || '任务会自动保存，可以从对话卡片继续。'}
                  </p>
                </div>
              </div>
              {nativeGeneration?.error && (
                <div className="ljbot-generation-error" role="alert">
                  {nativeGeneration.error}
                </div>
              )}
              {nativeGeneration?.phase === 'review' && nativeGeneration.outlines.length > 0 ? (
                <div className="ljbot-generation-editor">
                  <OutlinesEditor
                    outlines={nativeGeneration.outlines}
                    onChange={(outlines) =>
                      frame.current?.contentWindow?.postMessage(
                        { type: 'ljkt-bot:outline-change', outlines },
                        window.location.origin,
                      )
                    }
                    onConfirm={() =>
                      frame.current?.contentWindow?.postMessage(
                        { type: 'ljkt-bot:outline-confirm' },
                        window.location.origin,
                      )
                    }
                    onBack={() =>
                      frame.current?.contentWindow?.postMessage(
                        { type: 'ljkt-bot:generation-cancel' },
                        window.location.origin,
                      )
                    }
                    alwaysReview
                    isLoading={nativeGeneration.isConfirming}
                    isStreaming={nativeGeneration.isStreaming}
                  />
                </div>
              ) : (
                <div className="ljbot-generation-progress" aria-live="polite">
                  {nativeGeneration?.phase !== 'failed' && (
                    <>
                      <div className="ljbot-generation-progress-heading">
                        <span>
                          {nativeGeneration?.phase === 'generating-content'
                            ? '课件生成进度'
                            : '大纲整理进度'}
                        </span>
                        <strong>{Math.floor(generationProgress)}%</strong>
                      </div>
                      <div className="ljbot-generation-progress-track">
                        <span
                          role="progressbar"
                          aria-label={
                            nativeGeneration?.phase === 'generating-content'
                              ? '课件生成等待进度估算'
                              : '大纲整理等待进度估算'
                          }
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.floor(generationProgress)}
                          style={{ width: `${generationProgress}%` }}
                        />
                      </div>
                    </>
                  )}
                  <p>
                    {nativeGeneration?.phase === 'generating-content'
                      ? '正在按已确认的大纲生成页面内容、互动和课堂讲解。完成后会自动回到 Bot 对话。'
                      : nativeGeneration?.phase === 'failed'
                        ? '可以关闭此面板，再从对话任务卡重试。'
                        : 'AI 正在结合主题和教学材料整理章节。大纲完成后会在这里出现。'}
                  </p>
                  {nativeGeneration?.phase !== 'failed' && (
                    <small>进度为等待估算；生成服务确认完成后会进入下一步。</small>
                  )}
                </div>
              )}
              <iframe
                ref={frame}
                className="ljbot-generation-engine"
                key={workspace.url}
                src={workspace.url}
                title="课件生成引擎"
                aria-hidden="true"
                tabIndex={-1}
                onLoad={() => void refreshCourses()}
              />
            </div>
          ) : (
            <iframe
              ref={frame}
              key={workspace.url}
              src={workspace.url}
              title="课件预览和编辑"
              allow="microphone; fullscreen; clipboard-write"
              onLoad={() => {
                void refreshCourses();
                try {
                  const currentFrame = frame.current;
                  const frameDocument = currentFrame?.contentDocument;
                  frameDocument?.addEventListener(
                    'click',
                    (event) => {
                      const target = event.target;
                      if (!target || typeof (target as Element).closest !== 'function') return;
                      const control = (target as Element).closest('a, button, [role="button"]');
                      if (!control) return;
                      const label = [
                        control.getAttribute('title'),
                        control.getAttribute('aria-label'),
                        control.textContent,
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                      if (
                        control.getAttribute('href') !== '/' &&
                        !label.includes('返回首页') &&
                        !label.includes('back to home')
                      )
                        return;
                      event.preventDefault();
                      event.stopImmediatePropagation();
                      botFrameActions.current.setWorkspace(null);
                      setWideWorkspace(false);
                      void refreshCourses();
                    },
                    true,
                  );
                  const path = currentFrame?.contentWindow?.location.pathname;
                  if (path === '/' || path === '/bot') {
                    setWorkspace(null);
                    setWideWorkspace(false);
                  }
                } catch {
                  // Cross-origin navigation cannot be inspected; the bridge still handles it.
                }
              }}
            />
          )}
        </section>
      )}
      <BotCourseLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onChanged={refreshCourses}
        onOpenCourse={(course, view) => {
          setLibraryOpen(false);
          void execute({
            type: 'open-course',
            courseId: course.id,
            title: course.name,
            view,
          });
        }}
      />
      {diagnosticsOpen && (
        <div
          className="ljbot-downloads-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDiagnosticsOpen(false);
          }}
        >
          <section
            className="ljbot-downloads"
            role="dialog"
            aria-modal="true"
            aria-label="连接诊断"
          >
            <header>
              <div>
                <strong>连接诊断</strong>
                <span>只检查本机服务和设置状态，不会调用模型 API。</span>
              </div>
              <button title="关闭" onClick={() => setDiagnosticsOpen(false)}>
                <X size={17} />
              </button>
            </header>
            {!diagnosticReport ? (
              <p className="ljbot-muted">正在检查本机服务…</p>
            ) : (
              <>
                <dl className="ljbot-diagnostics-list">
                  {Object.entries(diagnosticReport).map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {(
                          {
                            checkedAt: '检查时间',
                            browserOnline: '浏览器联网状态',
                            localService: 'Bot 本机服务',
                            localInstance: '服务实例',
                            desktop: '桌面应用',
                            model: '文本模型',
                            modelKeyConfigured: '模型凭证已配置',
                            modelHost: '模型接口主机',
                            lastRequestId: '最近请求编号',
                            pdfParser: '文档解析器',
                            pdfParserKeyConfigured: '解析凭证已配置',
                          } as Record<string, string>
                        )[key] ?? key}
                      </dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="ljbot-diagnostics-note">
                  本机服务正常不代表外部模型或第三方课件脚本可达。验证模型请到“模型设置”点击“测试连接”；HTML
                  内的编译器还需检查课件兼容报告中的 Worker/WASM 资源。
                </p>
                <button onClick={() => void copyDiagnostics()}>复制脱敏诊断信息</button>
              </>
            )}
          </section>
        </div>
      )}
      {downloadsOpen && (
        <div
          className="ljbot-downloads-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDownloadsOpen(false);
          }}
        >
          <section
            className="ljbot-downloads"
            role="dialog"
            aria-modal="true"
            aria-label="下载记录"
          >
            <header>
              <div>
                <strong>下载记录</strong>
                <span>保存完成的课件与备份</span>
              </div>
              <button title="关闭" onClick={() => setDownloadsOpen(false)}>
                <X size={17} />
              </button>
            </header>
            {!downloadHistory.length ? (
              <p className="ljbot-muted">还没有完成的下载。</p>
            ) : (
              <ul>
                {downloadHistory.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.filename}</strong>
                      <span>{new Date(item.completedAt).toLocaleString()}</span>
                    </div>
                    <button
                      onClick={() => {
                        void (
                          window as typeof window & {
                            ljktDesktop?: { openDownloadedItem(id: string): Promise<boolean> };
                          }
                        ).ljktDesktop
                          ?.openDownloadedItem(item.id)
                          .catch(() => toast.error('文件已移动或删除，无法打开位置。'));
                      }}
                    >
                      打开所在位置
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </main>
  );
}
