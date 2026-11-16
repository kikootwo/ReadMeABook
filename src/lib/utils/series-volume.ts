/**
 * Component: Series Volume Rules (tell volumes of one series apart)
 * Documentation: documentation/integrations/audible.md
 *
 * Pure rules shared by local dedup, the works-table collapse and the heal (#599).
 * Unknown on either side always means "compatible", so re-listings keep merging.
 */

import type { AudibleAudiobook } from '../integrations/audible.service';

type VolumeFields = Pick<AudibleAudiobook, 'asin' | 'title' | 'subtitle' | 'series' | 'seriesPart' | 'seriesAsin'>;

/** heal: same series, both positions known and different (it writes, so the strictest);
 *  dedup: + "Band N" keyword numbers, subtitle vs subtitle or title vs title; collapse: + a bare trailing title number */
export type VetoLevel = 'heal' | 'dedup' | 'collapse';

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const LABEL_WORDS = 'book|buch|band|bd|teil|folge|tome|tomo|tom|volume|volumen|vol|part|parte|titel|libro|livre|episode|episodio|deel|boek';
const BARE_RE = new RegExp(`^${NUM}$`);
const KEYWORD_FIRST_RE = new RegExp(`^(?:${LABEL_WORDS})\\.?\\s*${NUM}$`, 'i');
const NUMBER_FIRST_RE = new RegExp(`^${NUM}(?:\\.|\\.?\\s+(?:${LABEL_WORDS}))$`, 'i');

/** Keyword + N at the end of a subtitle or title; the text before it is the series-name prefix */
const VOLUME_KEYWORD_RE = /^(.*?)[\s,.:;\-–—]*\b(?:band|book|buch|teil|folge|tome|tomo|volume|vol\.?|part|titel)\s*(\d+(?:[.,]\d+)?)[\s.)]*$/i;
const TRAILING_NUMBER_RE = /\s(\d+(?:[.,]\d+)?)$/;
const TRAILING_GROUP_RE = /\s*[([][^)\]]*[)\]]\s*$/;

function toNumberString(raw: string): string {
  return String(parseFloat(raw.replace(',', '.')));
}

/** Position as a normalized number ("1", "1.5") from a sequence or one-number label ("1.0", "1,5",
 *  "Book 2", "Vol. 1", "1. Titel"); ranges ("1-3") and anything else are unknown */
export function normalizePosition(raw?: string | null): string | undefined {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const match = text.match(BARE_RE) ?? text.match(KEYWORD_FIRST_RE) ?? text.match(NUMBER_FIRST_RE);
  return match ? toNumberString(match[1]) : undefined;
}

function normalizeName(text?: string): string {
  return (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Same series ASIN; when either lacks one, the same normalized series name */
export function isSameSeries(a: VolumeFields, b: VolumeFields): boolean {
  if (a.seriesAsin && b.seriesAsin) return a.seriesAsin === b.seriesAsin;
  const nameA = normalizeName(a.series);
  return nameA !== '' && nameA === normalizeName(b.series);
}

/** Known in a series: carries a series ASIN or a series name */
function inSeries(book: VolumeFields): boolean {
  return Boolean(book.seriesAsin || normalizeName(book.series));
}

function keywordVolume(text?: string): { prefix: string; n: string } | null {
  const match = (text ?? '').trim().match(VOLUME_KEYWORD_RE);
  if (!match) return null;
  return { prefix: normalizeName(match[1]), n: toNumberString(match[2]) };
}

/** Both carry "<prefix> Band N" with the same non-empty prefix and different N */
function keywordNumbersDiffer(a?: string, b?: string): boolean {
  const va = keywordVolume(a);
  const vb = keywordVolume(b);
  return Boolean(va && vb && va.prefix !== '' && va.prefix === vb.prefix && va.n !== vb.n);
}

function trailingTitleNumber(title: string): string | undefined {
  const match = title.replace(TRAILING_GROUP_RE, '').trim().match(TRAILING_NUMBER_RE);
  return match ? toNumberString(match[1]) : undefined;
}

/** True when the two books are known to be different volumes at this level */
export function isDifferentVolume(a: VolumeFields, b: VolumeFields, level: VetoLevel): boolean {
  if (isSameSeries(a, b)) {
    const pa = normalizePosition(a.seriesPart);
    const pb = normalizePosition(b.seriesPart);
    if (pa !== undefined && pb !== undefined && pa !== pb) return true;
  }
  if (level === 'heal') return false;

  // Like with like only: subtitle vs subtitle, title vs title
  if (keywordNumbersDiffer(a.subtitle, b.subtitle) || keywordNumbersDiffer(a.title, b.title)) return true;
  if (level === 'dedup') return false;

  const ta = trailingTitleNumber(a.title);
  const tb = trailingTitleNumber(b.title);
  return ta !== undefined && tb !== undefined && ta !== tb;
}

/** Persist a merge only when every member has a known position or none is known to be in a series */
export function positionsSettled(members: VolumeFields[]): boolean {
  return members.every((m) => normalizePosition(m.seriesPart) !== undefined) || !members.some(inSeries);
}

/** Each work's canonical ASIN among `entries`, shared by collapse and heal: the lowest flagged ASIN
 *  (a legacy work can hold several flagged rows) */
export function canonicalByWork(entries: Array<{ asin: string; workId: string; isCanonical: boolean }>): Map<string, string> {
  return new Map(entries.filter((e) => e.isCanonical).sort((a, b) => (a.asin < b.asin ? 1 : -1)).map((e) => [e.workId, e.asin]));
}

/** Split one work's books into classes of compatible volumes, shared by collapse and heal: the anchor
 *  (canonical ASIN, else the first book) starts class 0; others join the first class with no veto */
export function partitionVolumes<T extends VolumeFields>(books: T[], canonicalAsin: string | undefined, level: VetoLevel): T[][] {
  const anchorIndex = Math.max(0, books.findIndex((b) => b.asin === canonicalAsin));
  const ordered = books.length > 0 ? [books[anchorIndex], ...books.filter((_, i) => i !== anchorIndex)] : [];
  const classes: T[][] = [];
  for (const book of ordered) {
    const home = classes.find((cls) => !cls.some((member) => isDifferentVolume(member, book, level)));
    if (home) home.push(book);
    else classes.push([book]);
  }
  return classes;
}
