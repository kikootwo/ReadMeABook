/**
 * Component: Import List Library Ownership Check
 * Documentation: documentation/backend/services/list-sync.md
 *
 * ReadMeABook's own library check is an exact ASIN match. A different edition of a book you own,
 * or a library item with no Audible ID, would look "missing" and be requested again. This adds a
 * second check: the same author surname and the same (cleaned) title already in the library.
 */

import { prisma } from '@/lib/db';

export interface OwnedIndex {
  asins: Set<string>;
  keys: Set<string>;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title without a leading track/volume number, "(Series #1)" suffixes and ": Subtitle" tails. */
function coreTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[\(\[][^)\]]*[\)\]]\s*/g, ' ')
    .replace(/^\s*\d+[\s.:-]+(?=\D)/, '')
    .split(/\s[-–—]\s|:\s/)[0];
  return normalize(cleaned);
}

function surname(author: string): string {
  const first = author.split(/[,&]| and /i)[0] || author;
  return normalize(first).split(' ').pop() || '';
}

export function ownedKey(author: string, title: string): string | null {
  const s = surname(author);
  const t = coreTitle(title);
  return s && t.length >= 3 ? `${s}|${t}` : null;
}

export async function loadOwnedIndex(): Promise<OwnedIndex> {
  const rows = await prisma.plexLibrary.findMany({ select: { asin: true, title: true, author: true } });
  const asins = new Set<string>();
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.asin) asins.add(row.asin);
    const key = ownedKey(row.author || '', row.title || '');
    if (key) keys.add(key);
  }
  return { asins, keys };
}

/** Returns how the book is owned ("asin" | "title and author"), or null. */
export function ownedHow(index: OwnedIndex, book: { asin?: string; title: string; author: string }[]): string | null {
  for (const candidate of book) {
    if (candidate.asin && index.asins.has(candidate.asin)) return 'asin';
  }
  for (const candidate of book) {
    const key = ownedKey(candidate.author, candidate.title);
    if (key && index.keys.has(key)) return 'title and author';
  }
  return null;
}
