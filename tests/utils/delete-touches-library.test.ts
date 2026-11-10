/**
 * Component: Delete Touches Library Tests (#212)
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { describe, expect, it } from 'vitest';
import { deleteTouchesLibrary } from '@/lib/utils/delete-touches-library';

const empty = { filePath: null, absItemId: null, plexGuid: null };

describe('deleteTouchesLibrary', () => {
  it('an audiobook request: a stored folder, an ABS item or a Plex item means in the library', () => {
    expect(deleteTouchesLibrary({ audiobook: { ...empty, filePath: '/media/a' } }, false)).toBe(true);
    expect(deleteTouchesLibrary({ audiobook: { ...empty, absItemId: 'abs-1' } }, false)).toBe(true);
    expect(deleteTouchesLibrary({ type: 'audiobook', audiobook: { ...empty, plexGuid: 'plex-1' } }, false)).toBe(true);
    expect(deleteTouchesLibrary({ type: 'audiobook', audiobook: empty }, false)).toBe(false);
  });

  it('judged by data, not status: placement records on an audiobook request are ignored', () => {
    expect(deleteTouchesLibrary({ type: 'audiobook', placedEbookFiles: [{ path: '/x' }], audiobook: empty }, false)).toBe(false);
  });

  it('an ebook request: any stored placement record but an empty list means in the library', () => {
    expect(deleteTouchesLibrary({ type: 'ebook', placedEbookFiles: [{ path: '/x.epub' }], audiobook: empty }, false)).toBe(true);
    expect(deleteTouchesLibrary({ type: 'ebook', placedEbookFiles: [{ unrecordedEarlierImport: true }], audiobook: empty }, false)).toBe(true);
    expect(deleteTouchesLibrary({ type: 'ebook', placedEbookFiles: { broken: true }, audiobook: empty }, false)).toBe(true);
    expect(deleteTouchesLibrary({ type: 'ebook', placedEbookFiles: [], audiobook: empty }, false)).toBe(false);
    expect(deleteTouchesLibrary({ type: 'ebook', placedEbookFiles: null, audiobook: { ...empty, filePath: '/media/a' } }, false)).toBe(false);
  });

  it('a book being imported (a live processing request on it) always counts', () => {
    expect(deleteTouchesLibrary({ type: 'audiobook', audiobook: empty }, true)).toBe(true);
    expect(deleteTouchesLibrary({ type: 'ebook', placedEbookFiles: [], audiobook: empty }, true)).toBe(true);
  });
});
