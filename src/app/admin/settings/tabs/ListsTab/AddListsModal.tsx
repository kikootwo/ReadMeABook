/**
 * Component: Add Lists modal (one list, or many pasted at once)
 * Documentation: documentation/backend/services/list-sync.md
 */

'use client';

import { useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { Field, Modal } from './Modal';
import { btnClass, btnPrimaryClass, inputClass } from './types';
import type { FilterProfileItem } from './types';

interface Props {
  profiles: FilterProfileItem[];
  onClose: () => void;
  onAdded: (message: string) => void;
}

interface BatchResult {
  source: string;
  ok: boolean;
  error?: string;
  list?: { name: string };
}

export function AddListsModal({ profiles, onClose, onAdded }: Props) {
  const [text, setText] = useState('');
  const [profileId, setProfileId] = useState(profiles.find((p) => p.name.startsWith('Strict'))?.id ?? '');
  const [topN, setTopN] = useState(100);
  const [autoRequest, setAutoRequest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[] | null>(null);

  const sources = text.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);

  const test = async () => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await fetchWithAuth('/api/admin/import-lists/test', { method: 'POST', body: JSON.stringify({ source: sources[0] }) });
      const data = await response.json();
      if (data.success) setTestResult(`Found “${data.name}” with ${data.size.toLocaleString()} books.`);
      else setError(data.error || 'Could not read that list');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetchWithAuth('/api/admin/import-lists', {
        method: 'POST',
        body: JSON.stringify({ sources, topN, autoRequest, filterProfileId: profileId || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add the lists');
      if (data.failed > 0) {
        setResults(data.results);
        if (data.added > 0) onAdded(`Added ${data.added} list(s); ${data.failed} could not be added`);
      } else {
        onAdded(`Added ${data.added} list${data.added === 1 ? '' : 's'}`);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the lists');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add lists"
      onClose={onClose}
      footer={
        <>
          <button className={btnClass} onClick={onClose}>{results ? 'Close' : 'Cancel'}</button>
          {!results && sources.length === 1 && <button className={btnClass} onClick={test} disabled={busy}>Test</button>}
          {!results && (
            <button className={btnPrimaryClass} onClick={add} disabled={busy || sources.length === 0}>
              {busy ? 'Adding…' : sources.length > 1 ? `Add ${sources.length} lists` : 'Add list'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Goodreads list links or numbers" hint="One per line. Example: https://www.goodreads.com/list/show/135.Best_Horror_Novels or just 135">
          <textarea className={`${inputClass} font-mono h-32`} value={text} onChange={(e) => { setText(e.target.value); setTestResult(null); setResults(null); }} placeholder={'135\n264\nhttps://www.goodreads.com/list/show/50.The_Best_Epic_Fantasy_fiction_'} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Filter profile" hint="Rules for which books are requested">
            <select className={inputClass} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">No filter</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Books to read from the top" hint="Goodreads pages hold 100 books">
            <input type="number" className={inputClass} min={10} max={2000} value={topN} onChange={(e) => setTopN(Number(e.target.value))} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
          <input type="checkbox" checked={autoRequest} onChange={(e) => setAutoRequest(e.target.checked)} className="h-4 w-4" />
          Request missing books automatically
        </label>
        {testResult && <p className="text-sm text-green-700 dark:text-green-400">{testResult}</p>}
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        {results && (
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                {r.ok ? `Added “${r.list?.name}”` : `${r.source}: ${r.error}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
