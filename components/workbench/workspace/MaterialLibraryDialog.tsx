'use client';

import { useEffect, useMemo, useState } from 'react';
import { Archive, LoaderCircle, RefreshCw, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  listWorkbenchMaterials,
  moveWorkbenchMaterialToFolder,
  uploadWorkbenchMaterial,
  WORKBENCH_ATTACH_MATERIAL_EVENT,
  type WorkbenchMaterial,
} from '@/lib/workbench/session-store';
import { WORKBENCH_MATERIAL_ACCEPT } from '@/lib/workbench/material-upload-policy';

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MaterialLibraryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [materials, setMaterials] = useState<WorkbenchMaterial[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [folderFilter, setFolderFilter] = useState('all');
  const [newFolderFor, setNewFolderFor] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    void listWorkbenchMaterials()
      .then((items) => {
        if (active) setMaterials(items);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : t('workbench.material.library.loadFailed'),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, reloadToken, t]);

  const visibleMaterials = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? materials.filter((material) => material.name.toLocaleLowerCase().includes(needle))
      : materials;
  }, [materials, query]);

  const folders = useMemo(
    () =>
      [
        ...new Set(
          materials.flatMap((material) => (material.folderName ? [material.folderName] : [])),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [materials],
  );
  const folderFilteredMaterials = visibleMaterials.filter((material) => {
    if (folderFilter === 'unfiled') return !material.folderName;
    return folderFilter === 'all' || material.folderName === folderFilter;
  });

  const moveToFolder = async (material: WorkbenchMaterial, folderName: string | null) => {
    try {
      const updated = await moveWorkbenchMaterialToFolder(material, folderName);
      setMaterials((items) =>
        items.map((item) => (item.materialId === updated.materialId ? updated : item)),
      );
      setNewFolderFor(null);
      setNewFolderName('');
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : t('workbench.material.library.folderSaveFailed'),
      );
    }
  };

  const upload = async (file?: File) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      await uploadWorkbenchMaterial(file);
      setReloadToken((token) => token + 1);
      toast.success(t('workbench.material.library.uploaded'));
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : t('workbench.material.uploadFailed', { name: file.name }),
      );
    } finally {
      setUploading(false);
    }
  };

  const attach = (material: WorkbenchMaterial) => {
    window.dispatchEvent(
      new CustomEvent<WorkbenchMaterial>(WORKBENCH_ATTACH_MATERIAL_EVENT, { detail: material }),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(80vh,720px)] max-w-[min(92vw,620px)] grid-rows-[auto_auto_1fr_auto] gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-4" aria-hidden="true" />
            {t('workbench.material.library.title')}
          </DialogTitle>
          <DialogDescription>{t('workbench.material.library.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('workbench.material.library.search')}
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('workbench.material.library.refresh')}
            title={t('workbench.material.library.refresh')}
            onClick={() => setReloadToken((token) => token + 1)}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          <select
            aria-label={t('workbench.material.library.folderFilter')}
            className="h-9 max-w-40 rounded-md border border-border bg-background px-2 text-sm"
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
          >
            <option value="all">{t('workbench.material.library.allFolders')}</option>
            <option value="unfiled">{t('workbench.material.library.unfiled')}</option>
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-0 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-destructive">
              <p>{t('workbench.material.library.loadFailed')}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{error}</p>
            </div>
          ) : folderFilteredMaterials.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {query || folderFilter !== 'all'
                ? t('workbench.material.library.noMatch')
                : t('workbench.material.library.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {folderFilteredMaterials.map((material) => (
                <li key={material.materialId} className="flex items-center gap-3 px-3 py-2.5">
                  <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={material.name}>
                      {material.name}
                    </p>
                    {newFolderFor === material.materialId ? (
                      <form
                        className="mt-1 flex items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const folder = newFolderName.trim();
                          if (folder) void moveToFolder(material, folder);
                        }}
                      >
                        <Input
                          autoFocus
                          maxLength={80}
                          value={newFolderName}
                          onChange={(event) => setNewFolderName(event.target.value)}
                          placeholder={t('workbench.material.library.folderPlaceholder')}
                          className="h-7 text-xs"
                        />
                        <Button type="submit" size="xs" disabled={!newFolderName.trim()}>
                          {t('workbench.material.library.saveFolder')}
                        </Button>
                      </form>
                    ) : (
                      <p className="truncate text-xs text-muted-foreground">
                        {prettyBytes(material.bytes)}
                        {material.mimeType ? ` · ${material.mimeType}` : ''}
                        {material.folderName ? ` · ${material.folderName}` : ''}
                      </p>
                    )}
                  </div>
                  {newFolderFor !== material.materialId ? (
                    <select
                      aria-label={t('workbench.material.library.moveToFolder', {
                        name: material.name,
                      })}
                      className="h-8 max-w-32 rounded-md border border-border bg-background px-1.5 text-xs"
                      value={material.folderName ?? ''}
                      onChange={(event) => {
                        if (event.target.value === '__new__') {
                          setNewFolderFor(material.materialId);
                          setNewFolderName('');
                        } else {
                          void moveToFolder(material, event.target.value || null);
                        }
                      }}
                    >
                      <option value="">{t('workbench.material.library.unfiled')}</option>
                      {folders.map((folder) => (
                        <option key={folder} value={folder}>
                          {folder}
                        </option>
                      ))}
                      <option value="__new__">{t('workbench.material.library.newFolder')}</option>
                    </select>
                  ) : null}
                  <Button type="button" size="sm" onClick={() => attach(material)}>
                    {t('workbench.material.library.attach')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t('workbench.material.library.persistentHint')}
          </p>
          <label className="inline-flex cursor-pointer">
            <input
              type="file"
              accept={WORKBENCH_MATERIAL_ACCEPT}
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                void upload(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
            <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium hover:bg-muted">
              {uploading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {t('workbench.material.library.upload')}
            </span>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
