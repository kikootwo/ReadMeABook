/**
 * Component: Add Torrent Dialog Tests
 * Documentation: documentation/phase3/manual-torrent-download.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddTorrentDialog } from '@/app/admin/components/AddTorrentDialog';

const fetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const mutateMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchMock }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toastMock }));
vi.mock('swr', () => ({ mutate: mutateMock }));

const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const CLIENTS = { clients: [{ type: 'qbittorrent', enabled: true }] };

let addResponse: () => unknown;

function renderDialog(onClose = vi.fn()) {
  render(<AddTorrentDialog isOpen onClose={onClose} requestId="req-1" bookTitle="Generated Title" />);
  return onClose;
}
const magnetField = () => screen.getByLabelText('Magnet link') as HTMLInputElement;
const addButton = () => screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
const chooseButton = () => screen.queryByRole('button', { name: 'Choose .torrent file' }) as HTMLButtonElement | null;
const pickFile = (file: File) => fireEvent.change(screen.getByTestId('add-torrent-file'), { target: { files: [file] } });
const addCall = () => fetchMock.mock.calls.find(([url]) => url === '/api/admin/requests/req-1/add-torrent');

describe('AddTorrentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addResponse = () => json(200, { success: true });
    fetchMock.mockImplementation(async (url: string) => (url === '/api/admin/settings/download-clients' ? json(200, CLIENTS) : addResponse()));
  });

  it('opens on the book title with the magnet field focused, Add disabled until something is given', async () => {
    renderDialog();
    expect(screen.getByText('Add Torrent')).toBeInTheDocument();
    expect(screen.getByText('Generated Title')).toBeInTheDocument();
    expect(document.activeElement).toBe(magnetField());
    expect(addButton()).toBeDisabled();
    expect(screen.getByText('Once it finishes, a torrent added here seeds until you remove it in your client.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/download-clients'));
  });

  it('a magnet: the file button is disabled; Add sends the trimmed magnet, then toasts, closes and refreshes', async () => {
    const onClose = renderDialog();
    fireEvent.change(magnetField(), { target: { value: '  magnet:?xt=urn:btih:abc  ' } });
    expect(chooseButton()).toBeDisabled();

    fireEvent.click(addButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [, init] = addCall()!;
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(init.body)).toEqual({ magnet: 'magnet:?xt=urn:btih:abc' });
    expect(toastMock.success).toHaveBeenCalledWith('Torrent added.');
    const filters = mutateMock.mock.calls.map(([filter]) => filter as unknown as (key: unknown) => boolean);
    expect(filters.some((f) => f('/api/admin/requests/recent?limit=50'))).toBe(true);
    expect(filters.some((f) => f('/api/admin/metrics'))).toBe(true);
  });

  it('a file: the magnet field is disabled, Remove brings it back, and Add sends the bytes as base64', async () => {
    const onClose = renderDialog();
    const bytes = new Uint8Array([100, 52, 58, 105, 110, 102, 111, 0, 255, 128]);
    pickFile(new File([bytes], 'generated.torrent', { type: 'application/x-bittorrent' }));

    expect(screen.getByText('generated.torrent')).toBeInTheDocument();
    expect(magnetField()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(magnetField()).not.toBeDisabled();
    expect(chooseButton()).not.toBeNull();

    pickFile(new File([bytes], 'generated.torrent'));
    fireEvent.click(addButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(addCall()![1].body)).toEqual({ torrentFile: Buffer.from(bytes).toString('base64') });
  });

  it('closes and toasts before the lists finish refreshing (a slow list never holds the dialog open)', async () => {
    mutateMock.mockImplementation(() => new Promise(() => undefined)); // the refreshes never settle
    const onClose = renderDialog();
    fireEvent.change(magnetField(), { target: { value: 'magnet:?xt=urn:btih:abc' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastMock.success).toHaveBeenCalledWith('Torrent added.');
    expect(mutateMock).toHaveBeenCalledTimes(2);
    expect(toastMock.success.mock.invocationCallOrder[0]).toBeLessThan(mutateMock.mock.invocationCallOrder[0]);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(mutateMock.mock.invocationCallOrder[0]);
    mutateMock.mockImplementation(async () => undefined);
  });

  it('Remove clears the old error and puts focus back on the file button', async () => {
    addResponse = () => json(400, { message: 'Not a valid .torrent file.' });
    renderDialog();
    pickFile(new File([new Uint8Array([1, 2, 3])], 'generated.torrent'));
    fireEvent.click(addButton());
    expect(await screen.findByText('Not a valid .torrent file.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('Not a valid .torrent file.')).toBeNull();
    expect(document.activeElement).toBe(chooseButton());
  });

  it('a file over 2 MB is refused in the dialog and never sent', () => {
    renderDialog();
    pickFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.torrent'));
    expect(screen.getByText('This file is larger than 2 MB.')).toBeInTheDocument();
    expect(screen.queryByText('big.torrent')).toBeNull();
    expect(addButton()).toBeDisabled();
  });

  it('while sending it cannot be closed (Escape, backdrop, Cancel) and shows Adding…', async () => {
    let finish!: (value: unknown) => void;
    addResponse = () => new Promise((resolve) => { finish = resolve; });
    const onClose = renderDialog();
    fireEvent.change(magnetField(), { target: { value: 'magnet:?xt=urn:btih:abc' } });
    fireEvent.click(addButton());

    await screen.findByText('Adding…');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.fixed.inset-0.bg-black\\/50')!);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finish(json(200, { success: true })));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['a proxy 413', () => ({ ok: false, status: 413, json: async () => { throw new Error('html'); } }), 'This file is larger than your server accepts.'],
    ['the server\'s message', () => json(400, { message: 'Not a valid .torrent file.' }), 'Not a valid .torrent file.'],
    ['a non-JSON error', () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } }), 'Adding the torrent failed (HTTP 502).'],
  ])('shows %s inline and stays open', async (_label, response, message) => {
    addResponse = response;
    const onClose = renderDialog();
    fireEvent.change(magnetField(), { target: { value: 'magnet:?xt=urn:btih:abc' } });
    fireEvent.click(addButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on an install with no torrent client it says so when it opens and offers nothing to send', async () => {
    fetchMock.mockImplementation(async () => json(200, { clients: [{ type: 'sabnzbd', enabled: true }, { type: 'qbittorrent', enabled: false }] }));
    renderDialog();
    expect(await screen.findByText('No torrent client is set up. Add qBittorrent, Transmission or Deluge in Settings > Download Clients.')).toBeInTheDocument();
    expect(magnetField()).toBeDisabled();
    expect(chooseButton()).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });
});
