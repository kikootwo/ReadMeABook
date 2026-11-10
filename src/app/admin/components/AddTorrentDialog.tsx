/**
 * Component: Add Torrent Dialog (admin: a magnet link or a .torrent file for one request)
 * Documentation: documentation/phase3/manual-torrent-download.md
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { fetchWithAuth } from '@/lib/utils/api';
import { CLIENT_PROTOCOL_MAP, type DownloadClientType } from '@/lib/interfaces/download-client.interface';
import { MAX_UPLOADED_TORRENT_BYTES, NO_TORRENT_CLIENT_MESSAGE } from '@/lib/constants/manual-torrent';

interface AddTorrentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  bookTitle: string;
}

const FIELD_CLASS =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50';
const SECONDARY_BUTTON_CLASS =
  'px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50';

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A file's bytes as base64 (chunked, so a 2 MB file never overflows the call stack) */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** True when at least one enabled torrent client is configured; null when the list can't be read */
async function hasTorrentClient(): Promise<boolean | null> {
  try {
    const response = await fetchWithAuth('/api/admin/settings/download-clients');
    if (!response.ok) return null;
    const { clients } = (await response.json()) as { clients?: { type: DownloadClientType; enabled: boolean }[] };
    return (clients ?? []).some((client) => client.enabled && CLIENT_PROTOCOL_MAP[client.type] === 'torrent');
  } catch {
    return null;
  }
}

export function AddTorrentDialog({ isOpen, onClose, requestId, bookTitle }: AddTorrentDialogProps) {
  const toast = useToast();
  const [magnet, setMagnet] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noTorrentClient, setNoTorrentClient] = useState(false);
  const magnetRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Each opening starts empty, focuses the magnet field, and checks for a torrent client
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setMagnet('');
    setFile(null);
    setError(null);
    setNoTorrentClient(false);
    magnetRef.current?.focus();
    hasTorrentClient().then((found) => {
      if (active) setNoTorrentClient(found === false);
    });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const handleClose = () => {
    if (!sending) onClose();
  };

  const chooseFile = (chosen: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''; // the same file can be chosen again after Remove
    if (!chosen) return;
    if (chosen.size > MAX_UPLOADED_TORRENT_BYTES) {
      setError('This file is larger than 2 MB.');
      return;
    }
    setError(null);
    setFile(chosen);
  };

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      const body = file ? { torrentFile: await fileToBase64(file) } : { magnet: magnet.trim() };
      const response = await fetchWithAuth(`/api/admin/requests/${requestId}/add-torrent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 413) throw new Error('This file is larger than your server accepts.');
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message || `Adding the torrent failed (HTTP ${response.status}).`);

      toast.success('Torrent added. Downloading now.');
      await mutate((key: unknown) => typeof key === 'string' && key.includes('/api/admin/requests'));
      await mutate((key: unknown) => typeof key === 'string' && key.includes('/api/admin/metrics'));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adding the torrent failed.');
    } finally {
      setSending(false);
    }
  };

  const blocked = sending || noTorrentClient;
  const canSubmit = !blocked && (!!file || magnet.trim() !== '');

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Torrent" size="sm" showCloseButton={!sending}>
      <div className="space-y-4">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">{bookTitle}</p>

        {noTorrentClient && (
          <p role="alert" className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 rounded-lg px-3 py-2">
            {NO_TORRENT_CLIENT_MESSAGE}
          </p>
        )}

        <div>
          <label htmlFor="add-torrent-magnet" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Magnet link
          </label>
          <input
            id="add-torrent-magnet"
            ref={magnetRef}
            type="text"
            value={magnet}
            onChange={(e) => {
              setMagnet(e.target.value);
              setError(null);
            }}
            disabled={blocked || !!file}
            autoComplete="off"
            spellCheck={false}
            placeholder="magnet:?xt=urn:btih:…"
            className={FIELD_CLASS}
          />
        </div>

        <div className="flex items-center gap-3" aria-hidden="true">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          <span className="text-xs text-gray-500 dark:text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".torrent,application/x-bittorrent"
            className="hidden"
            data-testid="add-torrent-file"
            onChange={(e) => chooseFile(e.target.files?.[0])}
          />
          {file ? (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50">
              <span className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-100 truncate">{file.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
              <button
                type="button"
                onClick={() => setFile(null)}
                disabled={sending}
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex-shrink-0 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={blocked || magnet.trim() !== ''}
              className={`${SECONDARY_BUTTON_CLASS} w-full`}
            >
              Choose .torrent file
            </button>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          ReadMeABook never removes torrents added here; they seed until you remove them in your client.
        </p>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button type="button" onClick={handleClose} disabled={sending} className={SECONDARY_BUTTON_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {sending && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />}
            {sending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
