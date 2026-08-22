'use client';

import React, { useState } from 'react';
import { CheckSquare, Eye, EyeOff, Loader2, Tag, TagsIcon, Trash2, X } from 'lucide-react';
import { BULK_ACTION_LABELS, BulkAction, BulkCollection } from '@/lib/bulk';

interface BulkActionsBarProps {
  collection: BulkCollection;
  selectedIds: string[];
  totalCount: number;
  /** Actions offered for this list; must be supported by the collection. */
  actions: BulkAction[];
  onClear: () => void;
  onSelectAll: () => void;
  onDone: () => void;
  /** Copy shown in the delete confirmation, since gallery deletes are permanent. */
  deleteWarning: string;
  customAction?: {
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    className?: string;
  };
}

export default function BulkActionsBar({
  collection,
  selectedIds,
  totalCount,
  actions,
  onClear,
  onSelectAll,
  onDone,
  deleteWarning,
  customAction,
}: BulkActionsBarProps) {
  const [running, setRunning] = useState<BulkAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagMode, setTagMode] = useState<'tag_add' | 'tag_remove' | null>(null);
  const [tagInput, setTagInput] = useState('');

  if (selectedIds.length === 0) return null;

  const run = async (action: BulkAction, tags?: string[]) => {
    setRunning(action);
    setError(null);
    try {
      const res = await fetch('/api/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, action, ids: selectedIds, tags }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'No se pudo completar la acción');
        return;
      }
      setConfirmDelete(false);
      setTagMode(null);
      setTagInput('');
      onDone();
    } catch {
      setError('Error de red al ejecutar la acción');
    } finally {
      setRunning(null);
    }
  };

  const submitTags = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagMode) return;
    const tags = tagInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      setError('Escribe al menos una etiqueta');
      return;
    }
    run(tagMode, tags);
  };

  const allSelected = selectedIds.length === totalCount;

  return (
    <div className="sticky top-2 z-30 bg-indigo-950/90 backdrop-blur border border-indigo-800 rounded-xl p-3 space-y-3 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold bg-indigo-600 text-white px-2 py-0.5 rounded text-[11px]">
            {selectedIds.length}
          </span>
          <span className="text-indigo-200">seleccionado{selectedIds.length === 1 ? '' : 's'}</span>
          {!allSelected && (
            <button
              onClick={onSelectAll}
              className="text-indigo-300 hover:text-white underline underline-offset-2 flex items-center gap-1"
            >
              <CheckSquare className="w-3 h-3" />
              <span>Seleccionar los {totalCount}</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actions.includes('publish') && (
            <button
              onClick={() => run('publish')}
              disabled={running !== null}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1 rounded-lg font-medium transition flex items-center gap-1"
            >
              {running === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{BULK_ACTION_LABELS.publish}</span>
            </button>
          )}

          {actions.includes('unpublish') && (
            <button
              onClick={() => run('unpublish')}
              disabled={running !== null}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 border border-zinc-700 px-3 py-1 rounded-lg font-medium transition flex items-center gap-1"
            >
              {running === 'unpublish' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
              <span>{BULK_ACTION_LABELS.unpublish}</span>
            </button>
          )}

          {actions.includes('tag_add') && (
            <button
              onClick={() => {
                setTagMode(tagMode === 'tag_add' ? null : 'tag_add');
                setError(null);
              }}
              disabled={running !== null}
              className={`px-3 py-1 rounded-lg font-medium transition flex items-center gap-1 border ${
                tagMode === 'tag_add'
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>{BULK_ACTION_LABELS.tag_add}</span>
            </button>
          )}

          {actions.includes('tag_remove') && (
            <button
              onClick={() => {
                setTagMode(tagMode === 'tag_remove' ? null : 'tag_remove');
                setError(null);
              }}
              disabled={running !== null}
              className={`px-3 py-1 rounded-lg font-medium transition flex items-center gap-1 border ${
                tagMode === 'tag_remove'
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
              }`}
            >
              <TagsIcon className="w-3.5 h-3.5" />
              <span>{BULK_ACTION_LABELS.tag_remove}</span>
            </button>
          )}

          {customAction && (
            <button
              onClick={customAction.onClick}
              disabled={running !== null}
              className={
                customAction.className ||
                'bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1 rounded-lg font-medium transition flex items-center gap-1'
              }
            >
              {customAction.icon && <customAction.icon className="w-3.5 h-3.5" />}
              <span>{customAction.label}</span>
            </button>
          )}

          {actions.includes('delete') && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={running !== null}
              className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-3 py-1 rounded-lg font-medium transition flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{BULK_ACTION_LABELS.delete}</span>
            </button>
          )}

          <button onClick={onClear} className="text-indigo-300 hover:text-white p-1 transition" title="Cancelar selección">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {tagMode && (
        <form onSubmit={submitTags} className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Etiquetas separadas por comas (ej: entrevista, música)"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={running !== null}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1"
          >
            {running === tagMode && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Aplicar</span>
          </button>
        </form>
      )}

      {confirmDelete && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-rose-950/70 border border-rose-800 rounded-lg p-2.5 text-xs">
          <span className="text-rose-200">
            {deleteWarning.replace('{count}', String(selectedIds.length))}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-rose-300 hover:text-white px-2 py-1 transition"
            >
              Cancelar
            </button>
            <button
              onClick={() => run('delete')}
              disabled={running !== null}
              className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-3 py-1 rounded-lg font-medium transition flex items-center gap-1"
            >
              {running === 'delete' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Confirmar</span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-rose-300 bg-rose-950/60 border border-rose-900 rounded-lg px-2.5 py-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
