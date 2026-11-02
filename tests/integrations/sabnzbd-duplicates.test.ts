/**
 * Component: SABnzbd duplicate NZB and retried add tests (#329)
 * Documentation: documentation/phase3/sabnzbd.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SABnzbdService } from '@/lib/integrations/sabnzbd.service';
import {
  ADDFILE_RESPONSES,
  CATEGORY,
  EXISTING_ID,
  JOB_NAME,
  NEW_ID,
  NEW_JOB_BY_MODE,
  NZB_URL,
  historySlot,
  queueSlot,
  type RawHistorySlot,
  type RawQueueSlot,
} from '../fixtures/sabnzbd-duplicates';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  get: vi.fn(),
  isAxiosError: vi.fn(() => false),
}));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));

type Mode = keyof typeof ADDFILE_RESPONSES;
type SabRequest = { params: Record<string, string> };

const reasonOf = (result: unknown) => (result as { blocklistReason?: string }).blocklistReason;

/** A stateful fake SABnzbd API: queue, history, archive, and what each addfile mode leaves behind. */
function fakeSab(initial: { queue?: RawQueueSlot[]; history?: RawHistorySlot[]; archive?: RawHistorySlot[] }, mode: Mode = 'off') {
  const state = {
    queue: [...(initial.queue ?? [])],
    history: [...(initial.history ?? [])],
    archive: [...(initial.archive ?? [])],
    uploads: 0,
    queueDeletes: [] as string[],
    historyDeletes: [] as string[],
  };

  // SABnzbd's convert_search: `*` and spaces are wildcards, the term matches anywhere, case-insensitive
  const matchesSearch = (name: string, search?: string) => {
    if (!search) return true;
    const pattern = search
      .split(/[* ]/)
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.'))
      .join('.*');
    return new RegExp(pattern, 'i').test(name);
  };

  clientMock.get.mockImplementation(async (_path: string, { params }: SabRequest) => {
    if (params.mode === 'get_config') {
      return { data: { config: { version: '4.5.5', misc: { complete_dir: '/sab/complete' }, categories: { [CATEGORY]: { dir: '' } } } } };
    }
    if (params.mode === 'queue' && params.name === 'delete') {
      state.queueDeletes.push(params.value);
      state.queue = state.queue.filter((slot) => slot.nzo_id !== params.value);
      return { data: { status: true, nzo_ids: [params.value] } };
    }
    if (params.mode === 'queue') {
      return { data: { queue: { slots: state.queue } } };
    }
    if (params.mode === 'history' && params.name === 'delete') {
      state.historyDeletes.push(params.value);
      const row = state.history.find((slot) => slot.nzo_id === params.value);
      state.history = state.history.filter((slot) => slot.nzo_id !== params.value);
      if (row) state.archive.push(row);
      return { data: { status: true, nzo_ids: [params.value] } };
    }
    if (params.mode === 'history') {
      const ids: string[] | undefined = params.nzo_ids ? String(params.nzo_ids).split(',') : undefined;
      const slots = (Number(params.archive) === 1 ? state.archive : state.history)
        .filter((slot) => !ids || ids.includes(slot.nzo_id))
        .filter((slot) => matchesSearch(slot.name, params.search));
      return { data: { history: { slots } } };
    }
    throw new Error(`unexpected SABnzbd call: ${JSON.stringify(params)}`);
  });

  clientMock.post.mockImplementation(async () => {
    state.uploads++;
    const leftBehind = mode === 'discard' ? undefined : NEW_JOB_BY_MODE[mode];
    if (leftBehind && 'queue' in leftBehind) state.queue.push({ ...leftBehind.queue });
    if (leftBehind && 'history' in leftBehind) state.history.unshift({ ...leftBehind.history });
    return { data: ADDFILE_RESPONSES[mode] };
  });

  return state;
}

describe('SABnzbd duplicate NZB handling (#329)', () => {
  let localRoot: string;
  let service: SABnzbdService;

  beforeEach(async () => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    axiosMock.get.mockReset();
    axiosMock.get.mockResolvedValue({ data: Buffer.from('<nzb/>'), headers: {} });
    localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-329-'));
    // SABnzbd sees /sab/complete; RMAB sees localRoot
    service = new SABnzbdService('http://sab', 'key', CATEGORY, localRoot, false, {
      enabled: true,
      remotePath: '/sab/complete',
      localPath: localRoot,
    });
  });

  afterEach(async () => {
    await fs.rm(localRoot, { recursive: true, force: true });
  });

  const filesOnDisk = () => fs.mkdir(path.join(localRoot, JOB_NAME), { recursive: true });
  const add = (options?: Record<string, unknown>) =>
    service.addDownload(NZB_URL, { category: CATEGORY, ...options }).catch((error: Error) => error);

  describe('discard mode (status false, no nzo_ids)', () => {
    it('tracks the existing job when it is still downloading', async () => {
      const sab = fakeSab({ queue: [queueSlot()] }, 'discard');

      expect(await add()).toEqual({ id: EXISTING_ID, alreadyInClient: true });
      expect(sab.uploads).toBe(1);
    });

    it('takes over the finished job when its files exist after path mapping', async () => {
      await filesOnDisk();
      fakeSab({ history: [historySlot()] }, 'discard');

      expect(await add()).toEqual({ id: EXISTING_ID, alreadyInClient: true });
    });

    it('finds the finished job in the archive, where RMAB moves jobs it has imported', async () => {
      await filesOnDisk();
      fakeSab({ archive: [historySlot()] }, 'discard');

      expect(await add()).toEqual({ id: EXISTING_ID, alreadyInClient: true });
    });

    it('rejects the release for the blocklist when the finished job has no files', async () => {
      fakeSab({ archive: [historySlot()] }, 'discard');

      const result = await add();

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).name).toBe('UnusableDownloadSourceError');
      expect((result as Error).message).toContain(`SABnzbd already has "${JOB_NAME}"`);
      expect(reasonOf(result)).toBe('Already in SABnzbd, files gone');
    });

    it('keeps the old failure when SABnzbd has no job with this name', async () => {
      fakeSab({ history: [historySlot({ name: 'Another.Book' })] }, 'discard');

      const result = await add();

      expect((result as Error).message).toBe('Failed to add NZB to SABnzbd');
      expect(reasonOf(result)).toBeUndefined();
    });

    it('ignores a failed history row and a row in another category', async () => {
      await filesOnDisk();
      fakeSab({ history: [historySlot({ status: 'Failed' }), historySlot({ nzo_id: 'other', category: 'tv' })] }, 'discard');

      expect((await add() as Error).message).toBe('Failed to add NZB to SABnzbd');
    });
  });

  describe('fail mode (new job failed to history with "Duplicate NZB")', () => {
    it('takes over the finished job and archives the failed duplicate row', async () => {
      await filesOnDisk();
      const sab = fakeSab({ history: [historySlot()] }, 'fail');

      expect(await add()).toEqual({ id: EXISTING_ID, alreadyInClient: true });
      expect(sab.historyDeletes).toEqual([NEW_ID]);
    });

    it('rejects the release for the blocklist when the finished job has no files', async () => {
      fakeSab({ history: [historySlot()] }, 'fail');

      expect(reasonOf(await add())).toBe('Already in SABnzbd, files gone');
    });
  });

  describe('pause mode (new job paused in the queue)', () => {
    it('removes the paused copy and takes over the finished job', async () => {
      await filesOnDisk();
      const sab = fakeSab({ history: [historySlot()] }, 'pause');

      expect(await add()).toEqual({ id: EXISTING_ID, alreadyInClient: true });
      expect(sab.queueDeletes).toEqual([NEW_ID]);
      expect(sab.queue).toEqual([]);
    });

    it('removes the paused copy and tracks the job already downloading (queue duplicate, SABnzbd 4.2+)', async () => {
      const sab = fakeSab({ queue: [queueSlot()] }, 'pause');

      expect(await add()).toEqual({ id: EXISTING_ID, alreadyInClient: true });
      expect(sab.queueDeletes).toEqual([NEW_ID]);
    });

    it('rejects the release for the blocklist when the finished job has no files', async () => {
      const sab = fakeSab({ history: [historySlot()] }, 'pause');

      expect(reasonOf(await add())).toBe('Already in SABnzbd, files gone');
      expect(sab.queueDeletes).toEqual([NEW_ID]);
    });
  });

  describe('modes where SABnzbd downloads a new copy', () => {
    it.each(['tag', 'off'] as const)('%s mode: tracks the new job, unchanged', async (mode) => {
      const sab = fakeSab({ history: [historySlot()] }, mode);

      expect(await add()).toEqual({ id: NEW_ID, alreadyInClient: false });
      expect(sab.queueDeletes).toEqual([]);
      expect(sab.historyDeletes).toEqual([]);
    });

    it('normal add with nothing in SABnzbd: unchanged', async () => {
      const sab = fakeSab({}, 'off');

      expect(await add()).toEqual({ id: NEW_ID, alreadyInClient: false });
      expect(sab.uploads).toBe(1);
    });

    it('a check that cannot reach SABnzbd after the add keeps the new job', async () => {
      fakeSab({}, 'off');
      const real = clientMock.get.getMockImplementation()!;
      clientMock.get.mockImplementation(async (url: string, config: SabRequest) => {
        if (config.params.mode === 'queue') throw new Error('socket hang up');
        return real(url, config);
      });

      expect(await add()).toEqual({ id: NEW_ID, alreadyInClient: false });
    });
  });

  describe('retried add (a timed-out upload SABnzbd accepted)', () => {
    it('reuses the job SABnzbd already holds instead of uploading a second copy', async () => {
      const sab = fakeSab({ queue: [queueSlot({ nzo_id: 'SABnzbd_nzo_first_try', status: 'Queued' })] }, 'off');

      expect(await add({ retry: true })).toEqual({ id: 'SABnzbd_nzo_first_try', alreadyInClient: true });
      expect(sab.uploads).toBe(0);
    });

    it('reuses a first try SABnzbd already finished when its files exist', async () => {
      await filesOnDisk();
      const sab = fakeSab({ history: [historySlot({ nzo_id: 'SABnzbd_nzo_first_try' })] }, 'off');

      expect(await add({ retry: true })).toEqual({ id: 'SABnzbd_nzo_first_try', alreadyInClient: true });
      expect(sab.uploads).toBe(0);
    });

    it('uploads when the only job SABnzbd holds is finished with its files gone', async () => {
      const sab = fakeSab({ history: [historySlot()] }, 'off');

      expect(await add({ retry: true })).toEqual({ id: NEW_ID, alreadyInClient: false });
      expect(sab.uploads).toBe(1);
    });

    it('uploads when SABnzbd does not hold it', async () => {
      const sab = fakeSab({ history: [historySlot({ name: 'Another.Book' })] }, 'off');

      expect(await add({ retry: true })).toEqual({ id: NEW_ID, alreadyInClient: false });
      expect(sab.uploads).toBe(1);
    });

    it('a first try does not look for an existing job before uploading', async () => {
      const sab = fakeSab({ queue: [queueSlot({ status: 'Queued' })] }, 'tag');

      expect(await add()).toEqual({ id: NEW_ID, alreadyInClient: false });
      expect(sab.uploads).toBe(1);
    });
  });

  describe('generic upload names never match another book (review finding 2)', () => {
    // Prowlarr's proxy path with no Content-Disposition: the upload falls back to download.nzb
    const PROWLARR_URL = 'http://prowlarr:9696/3/download?apikey=k&link=abc&file=Book+B';
    const addFrom = (url: string, options: Record<string, unknown>) =>
      service.addDownload(url, { category: CATEGORY, ...options }).catch((error: Error) => error);

    it('a retried add does not take another book\'s "download" job', async () => {
      const sab = fakeSab({ queue: [queueSlot({ nzo_id: 'SABnzbd_nzo_book_A', filename: 'download' })] }, 'off');

      expect(await addFrom(PROWLARR_URL, { retry: true, releaseTitle: 'Book B - Author B' })).toEqual({ id: NEW_ID, alreadyInClient: false });
      expect(sab.uploads).toBe(1);
    });

    it('a discarded add does not take over another book\'s finished "download" job: old failure', async () => {
      await fs.mkdir(path.join(localRoot, 'download'), { recursive: true });
      fakeSab({ archive: [historySlot({ nzo_id: 'SABnzbd_nzo_book_A', name: 'download', storage: '/sab/complete/download' })] }, 'discard');

      const result = await addFrom(PROWLARR_URL, { releaseTitle: 'Book B - Author B' });

      expect((result as Error).message).toBe('Failed to add NZB to SABnzbd');
    });

    it('an upload name that shares no word with the release title is not matched', async () => {
      axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('<nzb/>'), headers: { 'content-disposition': 'attachment; filename="a1b2c3d4e5.nzb"' } });
      const sab = fakeSab({ queue: [queueSlot({ nzo_id: 'SABnzbd_nzo_other', filename: 'a1b2c3d4e5' })] }, 'off');

      expect(await addFrom(NZB_URL, { retry: true, releaseTitle: 'My Audiobook Release' })).toEqual({ id: NEW_ID, alreadyInClient: false });
      expect(sab.uploads).toBe(1);
    });

    it('with a generic upload name, a job named as the release title is still found', async () => {
      const sab = fakeSab({ queue: [queueSlot({ status: 'Queued' })] }, 'off');

      expect(await addFrom(PROWLARR_URL, { retry: true, releaseTitle: JOB_NAME })).toEqual({ id: EXISTING_ID, alreadyInClient: true });
      expect(sab.uploads).toBe(0);
    });
  });

  describe('a paused existing job (review finding 3)', () => {
    it('is tracked and reported as paused', async () => {
      fakeSab({ queue: [queueSlot({ status: 'Paused' })] }, 'discard');

      expect(await add()).toEqual({ id: EXISTING_ID, alreadyInClient: true, paused: true });
    });
  });

  describe('monitoring a taken-over job', () => {
    it('finds a finished job outside the last 100 history rows by its nzo_id', async () => {
      const filler = Array.from({ length: 100 }, (_, i) => historySlot({ nzo_id: `filler-${i}`, name: `Filler.${i}` }));
      const sab = fakeSab({ history: [...filler, historySlot()] });
      // The plain history page holds only the newest 100 rows
      const real = clientMock.get.getMockImplementation()!;
      clientMock.get.mockImplementation(async (url: string, config: SabRequest) => {
        const response = await real(url, config);
        if (config.params.mode === 'history' && !config.params.nzo_ids) {
          response.data.history.slots = response.data.history.slots.slice(0, 100);
        }
        return response;
      });

      const info = await service.getDownload(EXISTING_ID);

      expect(info).toMatchObject({ id: EXISTING_ID, status: 'completed', downloadPath: `/sab/complete/${JOB_NAME}` });
      expect(sab.history).toHaveLength(101);
    });

    it('finds an archived finished job by its nzo_id', async () => {
      fakeSab({ archive: [historySlot()] });

      expect(await service.getDownload(EXISTING_ID)).toMatchObject({ id: EXISTING_ID, status: 'completed' });
    });
  });
});
