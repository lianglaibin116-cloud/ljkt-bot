'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import './bot-name-dialog.css';

export function BotNameDialog({
  title,
  label,
  initialValue = '',
  maxLength,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initialValue?: string;
  maxLength?: number;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    inputRef.current?.select();
    return () => dialog.close();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能保存，请重试。');
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="ljbot-name-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onCancel();
      }}
    >
      <form onSubmit={submit} aria-busy={submitting}>
        <h2 id={titleId}>{title}</h2>
        <label>
          {label}
          <input
            ref={inputRef}
            value={name}
            maxLength={maxLength}
            disabled={submitting}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
          />
        </label>
        {error && (
          <p id={errorId} role="alert">
            {error}
          </p>
        )}
        <div className="ljbot-name-actions">
          <button type="button" disabled={submitting} onClick={onCancel}>
            取消
          </button>
          <button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? '正在保存…' : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
