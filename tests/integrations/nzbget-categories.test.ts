/**
 * Component: NZBGet Category Tests (list, ownership, cancel match)
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NZBGetService } from '@/lib/integrations/nzbget.service';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(() => clientMock), get: vi.fn(), isAxiosError: vi.fn(() => false) }));
vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));

/** Answer each JSON-RPC method from a table; records every call */
function rpc(answers: Record<string, unknown>) {
  clientMock.post.mockImplementation(async (_url: string, body: { method: string }) => ({ data: { result: answers[body.method] } }));
}
const methods = () => clientMock.post.mock.calls.map(([, body]) => body.method);
const nzbget = (category: string, owned?: boolean) =>
  new NZBGetService('http://nzbget:6789', 'u', 'p', category, '/downloads', false, undefined, owned);

const config = [
  { Name: 'DestDir', Value: '/downloads' },
  { Name: 'Category2.Name', Value: 'audiobooks' },
  { Name: 'Category2.DestDir', Value: '/old' },
  { Name: 'Category1.Name', Value: 'readmeabook' },
  { Name: 'Category1.DestDir', Value: '/downloads' },
];

describe('NZBGet categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.post.mockReset();
  });

  it('getCategories returns configured names in slot order', async () => {
    rpc({ config });
    expect(await nzbget('readmeabook').getCategories()).toEqual(['readmeabook', 'audiobooks']);
  });

  it('getCategories throws when NZBGet can\'t be read', async () => {
    clientMock.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(nzbget('readmeabook').getCategories()).rejects.toThrow('Failed to get NZBGet categories: ECONNREFUSED');
  });

  it('an owned category in another case is updated in its own slot, not added to a new one', async () => {
    rpc({ config, saveconfig: true, reload: true, version: '24.0' });
    await nzbget('AudioBooks', true).ensureCategory();

    const save = clientMock.post.mock.calls.find(([, body]) => body.method === 'saveconfig');
    const written = save![1].params[0] as Array<{ Name: string; Value: string }>;
    expect(written.find((e) => e.Name === 'Category2.DestDir')?.Value).toBe('/downloads');
    expect(written.some((e) => e.Name === 'Category3.Name')).toBe(false);
  });

  it('a category that already existed (not owned) gets no saveconfig or reload', async () => {
    rpc({ config, saveconfig: true, reload: true, version: '24.0' });
    await nzbget('audiobooks', false).ensureCategory();
    await nzbget('missing-one', false).ensureCategory();
    expect(methods()).toEqual([]);
  });

  describe('deleteQueuedDownload (cancel)', () => {
    const queued = (Category: string, NZBName = 'Other.App.Release') => [{ NZBID: 42, NZBName, Category }];

    it('matches ReadMeABook\'s own category in any case', async () => {
      rpc({ listgroups: queued('AudioBooks'), editqueue: true });
      expect(await nzbget('audiobooks').deleteQueuedDownload('42', { name: 'Book.Release', category: 'audiobooks' })).toBe('deleted');
    });

    it('without a category (a shared one is never passed), a job of another name is kept', async () => {
      rpc({ listgroups: queued('books'), editqueue: true });
      expect(await nzbget('books', false).deleteQueuedDownload('42', { name: 'Book.Release' })).toBe('mismatch');
      expect(methods()).not.toContain('editqueue');
    });
  });
});
