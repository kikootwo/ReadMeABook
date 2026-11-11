/**
 * Component: Edit List modal
 * Documentation: documentation/backend/services/list-sync.md
 */

'use client';

import { useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { Field, Modal, Toggle } from './Modal';
import { btnClass, btnPrimaryClass, inputClass } from './types';
import type { FilterProfileItem, ImportListItem } from './types';

interface Props {
  list: ImportListItem;
  profiles: FilterProfileItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function EditListModal({ list, profiles, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: list.name,
    enabled: list.enabled,
    autoRequest: list.autoRequest,
    syncIntervalHours: list.syncIntervalHours,
    topN: list.topN,
    maxRequestsPerSync: list.maxRequestsPerSync,
    filterProfileId: list.filterProfileId ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetchWithAuth(`/api/admin/import-lists/${list.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...form, filterProfileId: form.filterProfileId || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.details ? JSON.stringify(data.details) : data.error || 'Could not save');
      onSaved(`Saved “${form.name}”`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit list"
      onClose={onClose}
      footer={
        <>
          <button className={btnClass} onClick={onClose}>Cancel</button>
          <button className={btnPrimaryClass} onClick={save} disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Goodreads list #{list.listId}{list.sourceSize ? ` · ${list.sourceSize.toLocaleString()} books` : ''} ·{' '}
          <a className="text-blue-600 dark:text-blue-400 hover:underline" href={list.url} target="_blank" rel="noopener noreferrer">open on Goodreads</a>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Books from the top" hint="Read this many ranked books">
            <input type="number" min={10} max={2000} className={inputClass} value={form.topN} onChange={(e) => set('topN', Number(e.target.value))} />
          </Field>
          <Field label="Sync every (hours)" hint="How often it is re-read">
            <input type="number" min={1} max={720} className={inputClass} value={form.syncIntervalHours} onChange={(e) => set('syncIntervalHours', Number(e.target.value))} />
          </Field>
          <Field label="Max requests per sync" hint="0 = no limit">
            <input type="number" min={0} max={1000} className={inputClass} value={form.maxRequestsPerSync} onChange={(e) => set('maxRequestsPerSync', Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Filter profile" hint="Rules for which books are requested">
          <select className={inputClass} value={form.filterProfileId} onChange={(e) => set('filterProfileId', e.target.value)}>
            <option value="">No filter</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enabled" hint="Paused lists are not synced on the schedule" />
        <Toggle checked={form.autoRequest} onChange={(v) => set('autoRequest', v)} label="Request missing books automatically" hint="Off = read and preview the list only" />
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
