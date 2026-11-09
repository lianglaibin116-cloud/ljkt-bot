'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BookOpen,
  Copy,
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useImportClassroom } from '@/lib/import/use-import-classroom';
import type { ClassroomManifest } from '@/lib/export/classroom-zip-types';
import {
  buildClassroomExportZip,
  classroomExportBaseName,
} from '@/lib/export/use-export-classroom';
import {
  createFolder,
  deleteStageData,
  loadStageData,
  listFolders,
  listStages,
  renameStage,
  setStageFolder,
  type StageListItem,
} from '@/lib/utils/stage-storage';
import type { FolderRecord } from '@/lib/utils/database';
import {
  archiveBotCourse,
  listBotCourseLibraryEntries,
  permanentlyRemoveBotCourseEntry,
  restoreBotCourse,
} from '@/lib/bot/course-library';
import './bot-course-library.css';

export function BotCourseLibrary({
  open,
  onClose,
  onOpenCourse,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onOpenCourse: (course: StageListItem, view: 'playback' | 'export') => void;
  onChanged: () => void;
}) {
  const [courses, setCourses] = useState<StageListItem[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState('all');
  const [showTrash, setShowTrash] = useState(false);
  const [error, setError] = useState('');
  const [copyingCourseId, setCopyingCourseId] = useState<string | null>(null);
  const copyInProgress = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [allCourses, allFolders, entries] = await Promise.all([
        listStages(),
        listFolders(),
        listBotCourseLibraryEntries(),
      ]);
      setCourses(allCourses);
      setFolders(allFolders);
      setArchived(
        new Set(entries.filter((entry) => entry.archivedAt).map((entry) => entry.stageId)),
      );
      setError('');
      onChanged();
    } catch {
      setError('读取课件库失败，请检查本机数据存储后重试。');
    }
  }, [onChanged]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const importer = useImportClassroom(() => {
    void refresh();
  });

  const duplicate = async (course: StageListItem) => {
    if (copyInProgress.current || importer.importing) return;
    copyInProgress.current = true;
    setCopyingCourseId(course.id);
    setError('');
    try {
      const snapshot = await loadStageData(course.id);
      if (!snapshot?.stage || snapshot.scenes.length === 0) {
        throw new Error('课件内容暂时无法读取。');
      }
      const exported = await buildClassroomExportZip(snapshot.stage, snapshot.scenes);
      const JSZip = (await import('jszip')).default;
      const archive = await JSZip.loadAsync(exported.zip);
      const manifestFile = archive.file('manifest.json');
      if (!manifestFile) throw new Error('课件副本缺少课程清单。');
      const manifest = JSON.parse(await manifestFile.async('text')) as ClassroomManifest;
      if (!manifest.stage || !Array.isArray(manifest.scenes)) {
        throw new Error('课件副本结构不完整。');
      }
      const copyName = `${course.name}（副本）`;
      manifest.stage.name = copyName;
      manifest.stage.createdAt = Date.now();
      manifest.stage.updatedAt = Date.now();
      archive.file('manifest.json', JSON.stringify(manifest, null, 2));
      const blob = await archive.generateAsync({ type: 'blob' });
      const file = new File([blob], `${classroomExportBaseName(copyName)}.maic.zip`, {
        type: 'application/zip',
      });
      const copiedStageId = await importer.importFile(file);
      if (!copiedStageId) return;
      if (course.folderId) await setStageFolder(copiedStageId, course.folderId);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? `复制课件失败：${cause.message}` : '复制课件失败，请重试。',
      );
    } finally {
      copyInProgress.current = false;
      setCopyingCourseId(null);
    }
  };

  const visibleCourses = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return courses.filter((course) => {
      const isArchived = archived.has(course.id);
      if (isArchived !== showTrash) return false;
      if (!showTrash && folderFilter !== 'all' && (course.folderId ?? '') !== folderFilter)
        return false;
      if (!normalized) return true;
      return `${course.name} ${course.description ?? ''}`.toLocaleLowerCase().includes(normalized);
    });
  }, [courses, archived, query, folderFilter, showTrash]);

  if (!open) return null;

  const changeFolder = async (courseId: string, folderId: string) => {
    try {
      await setStageFolder(courseId, folderId || undefined);
      await refresh();
    } catch {
      setError('移动课件失败，请重试。');
    }
  };

  const createNewFolder = async () => {
    const name = window.prompt('新文件夹名称');
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim());
      await refresh();
    } catch {
      setError('文件夹未能创建，请检查名称是否重复或过长。');
    }
  };

  const rename = async (course: StageListItem) => {
    const name = window.prompt('课件名称', course.name)?.trim();
    if (!name || name === course.name) return;
    try {
      await renameStage(course.id, name);
      await refresh();
    } catch {
      setError('重命名失败，请重试。');
    }
  };

  const archive = async (course: StageListItem) => {
    if (!window.confirm(`将“${course.name}”移到回收站？课件内容仍保留，可随时恢复。`)) return;
    try {
      await archiveBotCourse(course.id);
      await refresh();
    } catch {
      setError('移动到回收站失败，请重试。');
    }
  };

  const removePermanently = async (course: StageListItem) => {
    if (!window.confirm(`永久删除“${course.name}”？此操作会删除课件及其关联数据，不能恢复。`))
      return;
    try {
      await deleteStageData(course.id);
      await permanentlyRemoveBotCourseEntry(course.id);
      await refresh();
    } catch {
      setError('永久删除失败，课件仍保留在回收站。');
    }
  };

  const restore = async (course: StageListItem) => {
    try {
      await restoreBotCourse(course.id);
      await refresh();
    } catch {
      setError('恢复课件失败，请重试。');
    }
  };

  return (
    <div
      className="ljbot-library-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ljbot-library"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ljbot-library-title"
      >
        <header>
          <div>
            <BookOpen size={20} />
            <div>
              <h2 id="ljbot-library-title">我的课件</h2>
              <p>在 Bot 内搜索、整理、导入和恢复课件</p>
            </div>
          </div>
          <button aria-label="关闭课件库" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="ljbot-library-toolbar">
          <label className="ljbot-library-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索课件名称或描述"
            />
          </label>
          <select
            aria-label="按文件夹筛选"
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
            disabled={showTrash}
          >
            <option value="all">全部文件夹</option>
            <option value="">未归档</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <button onClick={() => setShowTrash((value) => !value)}>
            {showTrash ? <BookOpen size={15} /> : <Archive size={15} />}
            {showTrash ? '课件库' : '回收站'}
          </button>
          {!showTrash && (
            <>
              <button
                disabled={Boolean(copyingCourseId) || importer.importing}
                onClick={importer.triggerFileSelect}
              >
                <FileUp size={15} />
                导入课堂
              </button>
              <button onClick={() => void createNewFolder()}>
                <FolderPlus size={15} />
                新建文件夹
              </button>
              <input
                ref={importer.fileInputRef}
                type="file"
                hidden
                accept=".maic.zip,.zip"
                onChange={importer.handleFileChange}
              />
            </>
          )}
        </div>
        {error && (
          <div className="ljbot-library-error" role="alert">
            {error}
            <button onClick={() => setError('')}>关闭</button>
          </div>
        )}
        <div className="ljbot-library-list">
          {!visibleCourses.length && (
            <div className="ljbot-library-empty">{showTrash ? '回收站为空' : '没有找到课件'}</div>
          )}
          {visibleCourses.map((course) => (
            <article key={course.id}>
              <div className="ljbot-library-course-icon">
                <FileText size={18} />
              </div>
              <div className="ljbot-library-course-main">
                <strong>{course.name}</strong>
                <span>
                  {course.sceneCount} 页 · 更新于 {new Date(course.updatedAt).toLocaleDateString()}
                </span>
                {course.description && <p>{course.description}</p>}
              </div>
              {!showTrash && (
                <label className="ljbot-library-folder" title="移动到文件夹">
                  <Folder size={14} />
                  <select
                    aria-label={`移动 ${course.name} 到文件夹`}
                    value={course.folderId ?? ''}
                    onChange={(event) => void changeFolder(course.id, event.target.value)}
                  >
                    <option value="">未归档</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="ljbot-library-actions">
                {showTrash ? (
                  <>
                    <button onClick={() => void restore(course)}>
                      <RotateCcw size={14} />
                      恢复
                    </button>
                    <button className="danger" onClick={() => void removePermanently(course)}>
                      <Trash2 size={14} />
                      永久删除
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => onOpenCourse(course, 'playback')}>打开</button>
                    <button onClick={() => onOpenCourse(course, 'export')}>导出</button>
                    <button
                      title="复制页面、互动和媒体资源；不复制课堂进度和课程资料文档"
                      disabled={Boolean(copyingCourseId) || importer.importing}
                      onClick={() => void duplicate(course)}
                    >
                      <Copy size={14} />
                      {copyingCourseId === course.id ? '正在复制' : '复制'}
                    </button>
                    <button title="重命名课件" onClick={() => void rename(course)}>
                      <Settings2 size={14} />
                      重命名
                    </button>
                    <button title="移到回收站" onClick={() => void archive(course)}>
                      <Archive size={14} />
                      回收站
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
        <footer>
          {visibleCourses.length} 份课件{importer.importing ? ` · 正在导入：${importer.phase}` : ''}
        </footer>
      </section>
    </div>
  );
}
