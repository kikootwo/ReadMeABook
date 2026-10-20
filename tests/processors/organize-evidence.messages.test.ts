/**
 * Component: Organize Import Evidence Tests - untagged files and kept ebook downloads
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn() }) }));
vi.mock('@/lib/processors/organize-cleanup-guard', () => ({ planDownloadCleanup: vi.fn() }));

import { importStatusMessage } from '@/lib/processors/organize-evidence';
import type { ImportEvidence, PlacementRecord } from '@/lib/utils/import-inventory';

const copied = (name: string, tagsDropped?: string): PlacementRecord => ({
  source: `/d/${name}`, target: `/m/${name}`, status: 'copied', verified: true, tagsDropped,
});

function audio(records: PlacementRecord[]): ImportEvidence {
  return { records, inventory: { kind: 'audio', files: records.map((r) => r.source), complete: true } };
}

const LENGTH = 'the length could not be checked';
const DIFFERENT = 'the tagged version had a different length';

describe('untagged files on the request', () => {
  it('speaks of "the file" for a one-file book', () => {
    expect(importStatusMessage(audio([copied('Book.m4b', LENGTH)])))
      .toBe(`the file was imported without metadata tags (${LENGTH})`);
  });

  it('uses the singular for one of several files', () => {
    expect(importStatusMessage(audio([copied('a.mp3', LENGTH), copied('b.mp3'), copied('c.mp3')])))
      .toBe(`1 file imported without metadata tags (${LENGTH})`);
  });

  it('lists every distinct reason once', () => {
    const records = [copied('a.mp3', LENGTH), copied('b.mp3', DIFFERENT), copied('c.mp3', LENGTH)];
    expect(importStatusMessage(audio(records)))
      .toBe(`3 of 3 files imported without metadata tags (${LENGTH}; ${DIFFERENT})`);
  });

  it('counts a merged book as one library file', () => {
    const merged = ['ch1.mp3', 'ch2.mp3', 'ch3.mp3'].map((n) => ({ ...copied(n, DIFFERENT), target: '/m/Book.m4b' }));
    expect(importStatusMessage(audio(merged))).toBe(`the file was imported without metadata tags (${DIFFERENT})`);
  });
});

describe('ebook download kept for its other formats', () => {
  const ebook = (files: string[]): ImportEvidence => ({
    records: [{ source: files[0], target: '/m/Book.epub', status: 'copied', verified: true }],
    inventory: { kind: 'ebook', files, complete: true },
  });

  it('tells the user why it is kept and what to do', () => {
    expect(importStatusMessage(ebook(['/d/Book.epub', '/d/Book.pdf']), { folderRemovalPlanned: true })).toBe(
      'download kept: it holds several ebook formats and only one was imported; remove it from the download client once you no longer need the others'
    );
  });

  it('says nothing when the download would not be removed anyway', () => {
    expect(importStatusMessage(ebook(['/d/Book.epub', '/d/Book.pdf']))).toBeNull();
  });
});
