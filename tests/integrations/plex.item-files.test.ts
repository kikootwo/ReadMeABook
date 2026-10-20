/**
 * Component: Plex Item File Paths Tests (gate for the request-delete Plex delete)
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => clientMock }, create: () => clientMock }));

const { PlexService } = await import('@/lib/integrations/plex.service');

beforeEach(() => vi.clearAllMocks());

describe('PlexService.getItemFilePaths', () => {
  it('collects Media > Part file paths of an album and its tracks (JSON)', async () => {
    clientMock.get.mockImplementation(async (url: string) => ({
      data: url.endsWith('/children')
        ? {
            MediaContainer: {
              Metadata: [
                { Media: [{ Part: [{ file: '/data/Author/Book/01.mp3' }] }] },
                { Media: [{ Part: [{ file: '/data/Author/Book/02.mp3' }, { file: '/data/Author/Book/02.mp3' }] }] },
              ],
            },
          }
        : { MediaContainer: { Metadata: [{ type: 'album', title: 'Book' }] } },
    }));

    const files = await new PlexService().getItemFilePaths('http://plex', 'tok', '42');

    expect(files).toEqual(['/data/Author/Book/01.mp3', '/data/Author/Book/02.mp3']);
    expect(clientMock.get).toHaveBeenCalledWith('http://plex/library/metadata/42', expect.objectContaining({ headers: expect.objectContaining({ 'X-Plex-Token': 'tok' }) }));
    expect(clientMock.get).toHaveBeenCalledWith('http://plex/library/metadata/42/children', expect.anything());
  });

  it('reads XML responses (Part attributes)', async () => {
    clientMock.get.mockImplementation(async (url: string) => ({
      data: url.endsWith('/children')
        ? '<MediaContainer><Track><Media><Part file="/data/Book/01.m4b"/></Media></Track></MediaContainer>'
        : '<MediaContainer><Directory title="Book"/></MediaContainer>',
    }));

    expect(await new PlexService().getItemFilePaths('http://plex', 'tok', '42')).toEqual(['/data/Book/01.m4b']);
  });

  it('throws when Plex cannot be read (the caller then skips the delete)', async () => {
    clientMock.get.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new PlexService().getItemFilePaths('http://plex', 'tok', '42')).rejects.toThrow('ECONNREFUSED');
  });
});
