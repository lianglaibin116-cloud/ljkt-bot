import type { RefObject } from 'react';
import { Check, Download, Eraser, PenLine, Trash2, Undo2, Upload } from 'lucide-react';
import type { StandalonePlayerStrings } from '@/lib/export/standalone-html/contract';
import type { AnnotationTool } from './annotations';

export function AnnotationToolbar({
  strings,
  tool,
  color,
  width,
  hasCurrentStrokes,
  hasAnyAnnotations,
  storageStatus,
  importInputRef,
  onToolChange,
  onColorChange,
  onWidthChange,
  onUndo,
  onClear,
  onExport,
  onImport,
  onDone,
}: {
  strings: StandalonePlayerStrings;
  tool: AnnotationTool;
  color: string;
  width: number;
  hasCurrentStrokes: boolean;
  hasAnyAnnotations: boolean;
  storageStatus: 'saved' | 'unavailable';
  importInputRef: RefObject<HTMLInputElement | null>;
  onToolChange: (tool: AnnotationTool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onExport: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDone: () => void;
}) {
  const colors = [
    ['#e11d48', strings.annotationRed],
    ['#2563eb', strings.annotationBlue],
    ['#16a34a', strings.annotationGreen],
    ['#111827', strings.annotationBlack],
  ] as const;

  return (
    <div className="absolute left-3 top-3 z-50 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 text-slate-800 shadow-xl backdrop-blur">
      <span className="px-1 text-xs font-semibold text-slate-500">{strings.annotationTools}</span>
      <button
        type="button"
        onClick={() => onToolChange('pen')}
        aria-label={strings.annotationPen}
        aria-pressed={tool === 'pen'}
        title={strings.annotationPen}
        className={`rounded-lg p-2 ${tool === 'pen' ? 'bg-emerald-100 text-emerald-800' : 'hover:bg-slate-100'}`}
      >
        <PenLine className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onToolChange('eraser')}
        aria-label={strings.annotationEraser}
        aria-pressed={tool === 'eraser'}
        title={strings.annotationEraser}
        className={`rounded-lg p-2 ${tool === 'eraser' ? 'bg-emerald-100 text-emerald-800' : 'hover:bg-slate-100'}`}
      >
        <Eraser className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden="true" />
      {colors.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            onColorChange(value);
            onToolChange('pen');
          }}
          aria-label={label}
          aria-pressed={color === value && tool === 'pen'}
          title={label}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 hover:bg-slate-100"
        >
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: value }} />
        </button>
      ))}
      <div className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden="true" />
      <div className="flex items-center gap-1" role="group" aria-label={strings.annotationWidth}>
        {[2, 4, 7].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onWidthChange(value)}
            aria-label={`${strings.annotationWidth}: ${value}px`}
            aria-pressed={width === value}
            title={`${strings.annotationWidth}: ${value}px`}
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${width === value ? 'bg-emerald-100' : 'hover:bg-slate-100'}`}
          >
            <span
              className="rounded-full bg-current"
              style={{ width: value + 3, height: value + 3 }}
            />
          </button>
        ))}
      </div>
      <div className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden="true" />
      <button
        type="button"
        onClick={onUndo}
        disabled={!hasCurrentStrokes}
        aria-label={strings.annotationUndo}
        title={strings.annotationUndo}
        className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40"
      >
        <Undo2 className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!hasCurrentStrokes}
        aria-label={strings.annotationClear}
        title={strings.annotationClear}
        className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={!hasAnyAnnotations}
        aria-label={strings.annotationExport}
        title={strings.annotationExport}
        className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => importInputRef.current?.click()}
        aria-label={strings.annotationImport}
        title={strings.annotationImport}
        className="rounded-lg p-2 hover:bg-slate-100"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onImport}
      />
      <span className="px-1 text-[11px] text-slate-500" role="status">
        {storageStatus === 'saved' ? strings.annotationSaved : strings.annotationStorageUnavailable}
      </span>
      <button
        type="button"
        onClick={onDone}
        aria-label={strings.annotationDone}
        title={strings.annotationDone}
        className="rounded-lg bg-emerald-700 p-2 text-white hover:bg-emerald-800"
      >
        <Check className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
