/**
 * Component: Manual Torrent - the shared structure check runs before the upload is parsed
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * An uploaded .torrent reaches parse-torrent only after `isWellFormedTorrentFile` accepts it; a file
 * the check refuses is answered "Not a valid .torrent file." without being parsed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAIN, torrentFile } from '../helpers/fake-qbittorrent';

const check = vi.hoisted(() => ({ isWellFormedTorrentFile: vi.fn((bytes: Buffer) => bytes.length > 0) }));
const parser = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock('@/lib/integrations/torrent-file-check', () => check);
vi.mock('parse-torrent', async (importOriginal) => {
  const real = (await importOriginal()) as { default: (input: unknown) => unknown };
  parser.parse.mockImplementation((input: unknown) => real.default(input));
  return { default: (input: unknown) => parser.parse(input) };
});

const BASE64 = torrentFile(PLAIN).toString('base64');

describe('readUploadedTorrent and the shared structure check', () => {
  beforeEach(() => {
    check.isWellFormedTorrentFile.mockClear();
    parser.parse.mockClear();
  });

  it('checks the bytes, then parses them (a real torrent is accepted)', async () => {
    const { readUploadedTorrent } = await import('@/lib/services/manual-torrent');
    const result = await readUploadedTorrent(BASE64);
    expect(result).toMatchObject({ ok: true, value: { infoHash: PLAIN.v1 } });
    expect(check.isWellFormedTorrentFile).toHaveBeenCalledTimes(1);
    expect((check.isWellFormedTorrentFile.mock.calls[0][0] as Buffer).toString('base64')).toBe(BASE64);
    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(check.isWellFormedTorrentFile.mock.invocationCallOrder[0]).toBeLessThan(parser.parse.mock.invocationCallOrder[0]);
  });

  it('refuses a file the check rejects without parsing it', async () => {
    check.isWellFormedTorrentFile.mockReturnValueOnce(false);
    const { readUploadedTorrent } = await import('@/lib/services/manual-torrent');
    await expect(readUploadedTorrent(BASE64)).resolves.toEqual({ ok: false, error: 'Not a valid .torrent file.' });
    expect(parser.parse).not.toHaveBeenCalled();
  });
});
