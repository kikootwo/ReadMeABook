/**
 * Component: Lists Tab (Admin)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * System-wide management of public book lists (Goodreads Listopia): add, edit, pause, remove,
 * preview what a sync would do, sync now, read the history, and manage filter profiles.
 */

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { authenticatedFetcher, fetchWithAuth } from '@/lib/utils/api';
import { ConfirmDialog } from '@/app/admin/components/ConfirmDialog';
import { AddListsModal } from './AddListsModal';
import { EditListModal } from './EditListModal';
import { HistoryModal } from './HistoryModal';
import { PreviewModal } from './PreviewModal';
import { ProfilesSection } from './ProfilesSection';
import { STATUS_STYLE, btnClass, btnDangerClass, btnPrimaryClass, inputClass, timeAgo } from './types';
import type { FilterProfileItem, ImportListItem, ListStatus, ListsStatus } from './types';

type StatusFilter = 'all' | 'enabled' | 'paused' | 'error';
type SortKey = 'name' | 'size' | 'lastSync' | 'requested';

export function ListsTab() {
  const listsData = useSWR<{ lists: ImportListItem[] }>('/api/admin/import-lists', authenticatedFetcher, {
    // Refresh quickly while any list is syncing
    refreshInterval: (data) => (data?.lists.some((l) => l.status === 'syncing') ? 4000 : 0),
  });
  const profilesData = useSWR<{ profiles: FilterProfileItem[] }>('/api/admin/import-lists/profiles', authenticatedFetcher);
  const statusData = useSWR<ListsStatus>('/api/admin/import-lists/status', authenticatedFetcher, { refreshInterval: 30000 });
  const lists = useMemo(() => listsData.data?.lists ?? [], [listsData.data]);
  const profiles = useMemo(() => profilesData.data?.profiles ?? [], [profilesData.data]);
  const status = statusData.data ?? null;
  const loading = !listsData.data && !listsData.error;
  const loadError = listsData.error ? (listsData.error instanceof Error ? listsData.error.message : 'Could not load lists') : null;
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ImportListItem | null>(null);
  const [previewing, setPreviewing] = useState<ImportListItem | null>(null);
  const [history, setHistory] = useState<ImportListItem | null>(null);
  const [removing, setRemoving] = useState<ImportListItem[] | null>(null);
  const [bulkProfile, setBulkProfile] = useState('');
  const [guard, setGuard] = useState<{ minFreeGb: string; maxRequestsPerHour: string } | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setMessage({ text, error });
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 5000);
  }, []);

  const { mutate: mutateLists } = listsData;
  const { mutate: mutateProfiles } = profilesData;
  const { mutate: mutateStatus } = statusData;
  const load = useCallback(async () => {
    await Promise.all([mutateLists(), mutateProfiles(), mutateStatus()]);
  }, [mutateLists, mutateProfiles, mutateStatus]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = lists.filter((l) => {
      if (q && !l.name.toLowerCase().includes(q) && !String(l.listId).includes(q)) return false;
      if (filter === 'enabled') return l.enabled;
      if (filter === 'paused') return !l.enabled;
      if (filter === 'error') return l.status === 'error';
      return true;
    });
    const by: Record<SortKey, (a: ImportListItem, b: ImportListItem) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => (b.sourceSize ?? 0) - (a.sourceSize ?? 0),
      lastSync: (a, b) => new Date(b.lastSyncedAt ?? 0).getTime() - new Date(a.lastSyncedAt ?? 0).getTime(),
      requested: (a, b) => (b.lastRun?.requested ?? 0) - (a.lastRun?.requested ?? 0),
    };
    return [...rows].sort(by[sort]);
  }, [lists, search, filter, sort]);

  const allVisibleSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((l) => l.id)));

  const bulk = async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetchWithAuth('/api/admin/import-lists/bulk', { method: 'POST', body: JSON.stringify({ ids: [...selected], action, ...extra }) });
    const data = await response.json();
    if (response.ok) notify(`Updated ${data.count} list(s)`); else notify(data.error || 'Bulk action failed', true);
    if (action === 'delete') setSelected(new Set());
    load();
  };

  const syncNow = async (list: ImportListItem) => {
    const response = await fetchWithAuth(`/api/admin/import-lists/${list.id}/sync`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (response.ok) notify(`Syncing “${list.name}”…`); else notify(data.error || 'Could not start the sync', true);
    setTimeout(load, 1500);
  };

  const confirmRemove = async () => {
    if (!removing) return;
    for (const list of removing) await fetchWithAuth(`/api/admin/import-lists/${list.id}`, { method: 'DELETE' });
    notify(`Removed ${removing.length} list(s)`);
    setSelected((s) => { const n = new Set(s); removing.forEach((l) => n.delete(l.id)); return n; });
    setRemoving(null);
    load();
  };

  const saveGuard = async () => {
    if (!guard) return;
    const response = await fetchWithAuth('/api/admin/import-lists/status', {
      method: 'PUT',
      body: JSON.stringify({ minFreeGb: Number(guard.minFreeGb), maxRequestsPerHour: Number(guard.maxRequestsPerHour) }),
    });
    if (response.ok) { notify('Settings saved'); setGuard(null); load(); } else notify('Could not save the settings', true);
  };

  if (loading) return <div className="py-10 text-center text-gray-500">Loading lists…</div>;
  if (loadError) return <div className="py-10 text-center text-red-600">{loadError}</div>;

  const chip = (value: StatusFilter, label: string) => (
    <button key={value} className={`${btnClass} ${filter === value ? 'ring-2 ring-blue-500' : ''}`} onClick={() => setFilter(value)}>{label}</button>
  );

  return (
    <div className="space-y-8">
      {message && (
        <div role="status" className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm ${message.error ? 'bg-red-600 text-white' : 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'}`}>
          {message.text}
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Lists</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Public Goodreads lists that are checked on a schedule. Books you don&apos;t have yet are requested, within a disk-space guard and an hourly allowance.
        </p>
      </div>

      {status && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={`rounded-lg border p-4 ${status.lowDisk ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
            <p className="text-xs uppercase text-gray-500">Free space</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{status.freeGb === null ? '?' : `${status.freeGb.toLocaleString()} GB`}</p>
            <p className="text-xs text-gray-500">{status.lowDisk ? 'Below the guard: requests are paused' : `Requests stop below ${status.minFreeGb} GB`}</p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs uppercase text-gray-500">Requested this hour</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{status.requestedLastHour} <span className="text-base text-gray-500">/ {status.maxRequestsPerHour}</span></p>
            <p className="text-xs text-gray-500">{status.allowanceLeft} left this hour</p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs uppercase text-gray-500">Lists</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{lists.length}</p>
            <p className="text-xs text-gray-500">{status.lists.enabled} on · {status.lists.paused} paused</p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex flex-col justify-between">
            <p className="text-xs uppercase text-gray-500">Guards</p>
            {guard ? (
              <div className="space-y-2">
                <label className="block text-xs text-gray-500">Stop below (GB)<input type="number" min={0} className={inputClass} value={guard.minFreeGb} onChange={(e) => setGuard({ ...guard, minFreeGb: e.target.value })} /></label>
                <label className="block text-xs text-gray-500">Requests per hour<input type="number" min={0} className={inputClass} value={guard.maxRequestsPerHour} onChange={(e) => setGuard({ ...guard, maxRequestsPerHour: e.target.value })} /></label>
                <div className="flex gap-2"><button className={btnPrimaryClass} onClick={saveGuard}>Save</button><button className={btnClass} onClick={() => setGuard(null)}>Cancel</button></div>
              </div>
            ) : (
              <button className={btnClass} onClick={() => setGuard({ minFreeGb: String(status.minFreeGb), maxRequestsPerHour: String(status.maxRequestsPerHour) })}>Change limits</button>
            )}
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${inputClass} max-w-xs`} placeholder="Search lists…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {chip('all', 'All')}{chip('enabled', 'On')}{chip('paused', 'Paused')}{chip('error', 'Errors')}
          <select className={`${inputClass} w-auto`} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort lists">
            <option value="name">Sort: name</option><option value="size">Sort: size</option><option value="lastSync">Sort: last sync</option><option value="requested">Sort: last requested</option>
          </select>
          <div className="flex-1" />
          <button className={btnPrimaryClass} onClick={() => setAdding(true)}>Add lists</button>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2">
            <span className="text-sm font-medium text-blue-900 dark:text-blue-200">{selected.size} selected</span>
            <button className={btnClass} onClick={() => bulk('enable')}>Turn on</button>
            <button className={btnClass} onClick={() => bulk('disable')}>Pause</button>
            <button className={btnClass} onClick={() => bulk('set_auto_request', { autoRequest: true })}>Auto-request on</button>
            <button className={btnClass} onClick={() => bulk('set_auto_request', { autoRequest: false })}>Auto-request off</button>
            <select className={`${inputClass} w-auto`} value={bulkProfile} onChange={(e) => setBulkProfile(e.target.value)} aria-label="Filter profile for selected lists">
              <option value="">No filter</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className={btnClass} onClick={() => bulk('set_profile', { filterProfileId: bulkProfile || null })}>Apply profile</button>
            <button className={btnDangerClass} onClick={() => setRemoving(lists.filter((l) => selected.has(l.id)))}>Remove</button>
            <button className={btnClass} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2 w-8"><input type="checkbox" aria-label="Select all" checked={allVisibleSelected} onChange={toggleAll} /></th>
                <th className="px-3 py-2">List</th><th className="px-3 py-2 text-right">Size</th><th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Profile</th><th className="px-3 py-2">Last sync</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {visible.map((l) => {
                const s = STATUS_STYLE[l.status as ListStatus];
                return (
                  <tr key={l.id} className={l.enabled ? '' : 'opacity-60'}>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="px-3 py-2 min-w-[240px]">
                      <a className="font-medium text-gray-900 dark:text-gray-100 hover:underline" href={l.url} target="_blank" rel="noopener noreferrer">{l.name}</a>
                      <p className="text-xs text-gray-500">#{l.listId} · top {l.topN} · every {l.syncIntervalHours} h{l.autoRequest ? '' : ' · tracking only'}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{l.sourceSize ? l.sourceSize.toLocaleString() : '–'}</td>
                    <td className="px-3 py-2">
                      <span title={l.lastError ?? ''} className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
                      {l.lastError && <p className="text-xs text-red-600 dark:text-red-400 max-w-[200px] truncate" title={l.lastError}>{l.lastError}</p>}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 text-xs">{l.filterProfileName ?? <span className="text-gray-400">none</span>}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
                      <div>{timeAgo(l.lastSyncedAt)}</div>
                      {l.lastRun && <div className="text-gray-500">{l.lastRun.requested} requested · {l.lastRun.alreadyHave} have{l.lastRun.newOnList > 0 && <span className="text-green-600 dark:text-green-400"> · +{l.lastRun.newOnList} new</span>}</div>}
                      {l.lastRun?.stoppedReason && <div className="text-yellow-700 dark:text-yellow-400">stopped: {l.lastRun.stoppedReason}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right space-x-1">
                      <button className={btnClass} onClick={() => setPreviewing(l)}>Preview</button>
                      <button className={btnClass} onClick={() => syncNow(l)} disabled={l.status === 'syncing'}>Sync now</button>
                      <button className={btnClass} onClick={() => setHistory(l)}>History</button>
                      <button className={btnClass} onClick={() => setEditing(l)}>Edit</button>
                      <button className={btnDangerClass} onClick={() => setRemoving([l])}>Remove</button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">{lists.length === 0 ? 'No lists yet. Click “Add lists” and paste Goodreads list links.' : 'No lists match.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ProfilesSection profiles={profiles} onChanged={load} onMessage={notify} />

      {adding && <AddListsModal profiles={profiles} onClose={() => setAdding(false)} onAdded={(m) => { notify(m); load(); }} />}
      {editing && <EditListModal list={editing} profiles={profiles} onClose={() => setEditing(null)} onSaved={(m) => { notify(m); load(); }} />}
      {previewing && <PreviewModal list={previewing} onClose={() => setPreviewing(null)} />}
      {history && <HistoryModal list={history} onClose={() => setHistory(null)} />}
      {removing && (
        <ConfirmDialog
          isOpen
          title={removing.length === 1 ? 'Remove this list?' : `Remove ${removing.length} lists?`}
          message="The lists stop syncing and their history is deleted. Books already requested stay requested."
          confirmLabel="Remove"
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
