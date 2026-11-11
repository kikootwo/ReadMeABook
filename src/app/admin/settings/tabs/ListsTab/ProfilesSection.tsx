/**
 * Component: Filter Profiles section and editor
 * Documentation: documentation/backend/services/list-sync.md
 */

'use client';

import { useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { ConfirmDialog } from '@/app/admin/components/ConfirmDialog';
import { Field, Modal, Toggle } from './Modal';
import { btnClass, btnDangerClass, btnPrimaryClass, inputClass } from './types';
import type { FilterProfileItem } from './types';

type ProfileForm = Omit<FilterProfileItem, 'id' | 'builtIn' | 'listCount'>;

const EMPTY: ProfileForm = {
  name: '', skipPartsAndSets: true, titleExcludePatterns: [], authorExcludePatterns: [], requireAudibleAsin: true,
  allowAbridged: false, minRuntimeMinutes: 0, maxRuntimeMinutes: 0, minPublicationYear: 0, maxPublicationYear: 0,
  allowedLanguages: [], excludedPublishers: [], excludedNarrators: [], excludedGenres: [], includedGenres: [], minAudibleRating: 0,
};

const lines = (items: string[]) => items.join('\n');
const parseLines = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);

function describe(p: FilterProfileItem): string {
  const parts: string[] = [];
  if (p.skipPartsAndSets) parts.push('no box sets');
  if (!p.allowAbridged) parts.push('unabridged');
  if (p.allowedLanguages.length) parts.push(p.allowedLanguages.join('/'));
  if (p.minRuntimeMinutes) parts.push(`${Math.round(p.minRuntimeMinutes / 6) / 10}h+`);
  if (p.minAudibleRating) parts.push(`rated ${p.minAudibleRating}+`);
  if (p.titleExcludePatterns.length + p.authorExcludePatterns.length) parts.push('exclusions');
  return parts.join(' · ') || 'no rules';
}

function ProfileModal({ initial, onClose, onSaved }: { initial: (ProfileForm & { id?: string }) | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [form, setForm] = useState<ProfileForm & { id?: string }>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const num = (key: keyof ProfileForm) => (
    <input type="number" min={0} className={inputClass} value={form[key] as number} onChange={(e) => set(key, Number(e.target.value) as never)} />
  );
  const area = (key: keyof ProfileForm, placeholder: string, rows = 3) => (
    <textarea className={`${inputClass} font-mono`} rows={rows} placeholder={placeholder} value={lines(form[key] as string[])} onChange={(e) => set(key, parseLines(e.target.value) as never)} />
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id, ...body } = form;
      const response = await fetchWithAuth(id ? `/api/admin/import-lists/profiles/${id}` : '/api/admin/import-lists/profiles', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        const first = Array.isArray(data.details) ? data.details[0] : null;
        throw new Error(first?.message ? `${first.path?.join('.') ?? ''} ${first.message}` : data.error || 'Could not save');
      }
      onSaved(`Saved “${form.name}”`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={form.id ? 'Edit filter profile' : 'New filter profile'} onClose={onClose}
      footer={<><button className={btnClass} onClick={onClose}>Cancel</button><button className={btnPrimaryClass} onClick={save} disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="space-y-5">
        <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Toggle checked={form.skipPartsAndSets} onChange={(v) => set('skipPartsAndSets', v)} label="Skip box sets" hint="Omnibus, box sets, “books 1-3”" />
          <Toggle checked={form.requireAudibleAsin} onChange={(v) => set('requireAudibleAsin', v)} label="Needs an Audible match" hint="Books Audible does not carry are dropped" />
          <Toggle checked={form.allowAbridged} onChange={(v) => set('allowAbridged', v)} label="Allow abridged" hint="Off = unabridged only" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Field label="Min length (min)">{num('minRuntimeMinutes')}</Field>
          <Field label="Max length (min)" hint="0 = no limit">{num('maxRuntimeMinutes')}</Field>
          <Field label="Published from">{num('minPublicationYear')}</Field>
          <Field label="Published to" hint="0 = any">{num('maxPublicationYear')}</Field>
          <Field label="Min Audible rating">
            <input type="number" min={0} max={5} step={0.1} className={inputClass} value={form.minAudibleRating} onChange={(e) => set('minAudibleRating', Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Allowed languages" hint="One per line, e.g. english. Empty = any">{area('allowedLanguages', 'english')}</Field>
          <Field label="Only these genres" hint="One per line. Empty = any">{area('includedGenres', 'Science Fiction & Fantasy')}</Field>
          <Field label="Exclude genres" hint="One per line">{area('excludedGenres', 'Erotica')}</Field>
          <Field label="Exclude publishers" hint="One per line">{area('excludedPublishers', '')}</Field>
          <Field label="Exclude narrators" hint="One per line">{area('excludedNarrators', '')}</Field>
          <Field label="Exclude titles matching" hint="Regular expressions, one per line">{area('titleExcludePatterns', '\\bcoloring book\\b')}</Field>
          <Field label="Exclude authors matching" hint="Regular expressions, one per line">{area('authorExcludePatterns', '')}</Field>
        </div>
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}

export function ProfilesSection({ profiles, onChanged, onMessage }: { profiles: FilterProfileItem[]; onChanged: () => void; onMessage: (m: string, error?: boolean) => void }) {
  const [editing, setEditing] = useState<(ProfileForm & { id?: string }) | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<FilterProfileItem | null>(null);

  const remove = async () => {
    if (!deleting) return;
    const response = await fetchWithAuth(`/api/admin/import-lists/profiles/${deleting.id}`, { method: 'DELETE' });
    onMessage(response.ok ? `Deleted “${deleting.name}”` : 'Could not delete the profile', !response.ok);
    setDeleting(null);
    onChanged();
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Filter profiles</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Reusable rules that decide which list books are requested. Attach one to each list.</p>
        </div>
        <button className={btnPrimaryClass} onClick={() => setEditing(null)}>New profile</button>
      </div>
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        {profiles.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-[220px]">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.name} {p.builtIn && <span className="ml-1 text-xs text-gray-500">built-in</span>}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{describe(p)} · used by {p.listCount} list{p.listCount === 1 ? '' : 's'}</p>
            </div>
            <button className={btnClass} onClick={() => setEditing(p)}>Edit</button>
            <button className={btnClass} onClick={() => setEditing({ ...p, id: undefined, name: `${p.name} copy` })}>Duplicate</button>
            <button className={btnDangerClass} onClick={() => setDeleting(p)}>Delete</button>
          </div>
        ))}
        {profiles.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">No profiles yet.</p>}
      </div>
      {editing !== undefined && (
        <ProfileModal initial={editing} onClose={() => setEditing(undefined)} onSaved={(m) => { onMessage(m); onChanged(); }} />
      )}
      {deleting && (
        <ConfirmDialog
          isOpen
          title="Delete filter profile?"
          message={`“${deleting.name}” is used by ${deleting.listCount} list(s). They will go back to having no filter.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
