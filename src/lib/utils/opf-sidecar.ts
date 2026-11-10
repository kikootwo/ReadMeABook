/**
 * Component: OPF Sidecar (metadata.opf for Audiobookshelf, beside untouched audio)
 * Documentation: documentation/features/library-placement.md
 *
 * OPF 2.0 holding only <metadata>, with the elements Audiobookshelf's OPF parser reads.
 * Built from constant markup plus escaped text (no DTD, entities or CDATA), and
 * published create-only: an existing metadata.opf is kept and never opened.
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { writeFileAtomic, sameIdentity, type FileIdentity } from './copy-file';
import { applyFileMode, removeStalePartials, withTargetLock } from './organize-copy';
import { AUTHOR_SEPARATORS } from './path-template-variables';
import {
  MAX_DESCRIPTION_BYTES,
  bookDetailValues,
  capUtf8Bytes,
  sanitizeGenreName,
  sanitizeMetadataValue,
  sanitizeMultilineValue,
  truncateRawText,
} from './metadata-text';

export const OPF_FILE_NAME = 'metadata.opf';

/** Most authors, narrators or genres written (Audible lists far fewer). */
const MAX_NAMES = 20;

export interface OpfMetadata {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  asin?: string;
  series?: string;
  seriesPart?: string;
  description?: string;
  genres?: string[];
  publisher?: string;
  subtitle?: string;
  language?: string;
}

/**
 * Text for an XML 1.0 text node or attribute value: lone surrogates become U+FFFD,
 * control characters other than tab/LF/CR, U+FFFE and U+FFFF are dropped, then the five
 * predefined entities are escaped. Audiobookshelf parses strictly, so one bad character
 * would make it ignore the whole file.
 */
export function xmlText(value: string): string {
  return value
    .toWellFormed()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFE\uFFFF]/g, '')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

/** Name suffixes that follow a comma but are not a person of their own ("King, Jr."). */
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|phd|ph\.d|md|m\.d)\.?$/i;

/**
 * A list of people as Audiobookshelf should see them: split on the {primaryAuthor}
 * separators (, ; &), except that a comma before a suffix keeps it on the name
 * ("Martin Luther King, Jr." is one author). Sanitized, deduped, at most 20.
 */
export function splitPersonNames(value: string | undefined): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const separators = new RegExp(`(${AUTHOR_SEPARATORS.source})`);
  const parts = (value ?? '').split(separators);
  const entries: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const name = parts[i].trim();
    if (i > 0 && parts[i - 1] === ',' && NAME_SUFFIX.test(name) && entries.length > 0) {
      entries[entries.length - 1] = `${entries[entries.length - 1]}, ${name}`;
    } else {
      entries.push(name);
    }
  }
  for (const entry of entries) {
    const name = sanitizeMetadataValue(entry);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
    if (names.length >= MAX_NAMES) break;
  }
  return names;
}

const element = (name: string, text: string | undefined, attributes = ''): string | null =>
  text ? `    <${name}${attributes}>${xmlText(text)}</${name}>` : null;

const meta = (name: string, content: string | undefined): string | null =>
  content ? `    <meta name="${name}" content="${xmlText(content)}"/>` : null;

/** The OPF document, deterministic for the same input. Empty values write no element. */
export function buildOpf(book: OpfMetadata): string {
  const clean = (value: string | undefined) => (value ? sanitizeMetadataValue(value) || undefined : undefined);
  const details = bookDetailValues(book);
  const description = book.description
    ? capUtf8Bytes(sanitizeMultilineValue(truncateRawText(book.description)), MAX_DESCRIPTION_BYTES) || undefined
    : undefined;
  const year = Number.isInteger(book.year) && book.year! >= 1000 && book.year! <= 9999 ? String(book.year) : undefined;
  const genres = [...new Set((book.genres ?? []).map(sanitizeGenreName).filter(Boolean))].slice(0, MAX_NAMES);
  const series = clean(book.series);

  const lines = [
    element('dc:title', clean(book.title)),
    element('dc:subtitle', details.subtitle),
    ...splitPersonNames(book.author).map((name) => element('dc:creator', name, ' opf:role="aut"')),
    ...splitPersonNames(book.narrator).map((name) => element('dc:creator', name, ' opf:role="nrt"')),
    element('dc:publisher', details.publisher),
    element('dc:date', year),
    element('dc:language', details.language),
    element('dc:identifier', clean(book.asin), ' opf:scheme="ASIN"'),
    element('dc:description', description),
    ...genres.map((genre) => element('dc:subject', genre)),
    // Audiobookshelf reads the index from the meta right after the series
    meta('calibre:series', series),
    series ? meta('calibre:series_index', clean(book.seriesPart)) : null,
  ].filter((line): line is string => line !== null);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">',
    '  <metadata>',
    ...lines,
    '  </metadata>',
    '</package>',
    '',
  ].join('\n');
}

export type OpfOutcome =
  /** `digest`: sha256 of the bytes written (dev/ino alone can name a replacement on Linux). */
  | { outcome: 'written'; path: string; identity: FileIdentity; digest: string; warning?: string }
  | { outcome: 'kept'; path: string };

/**
 * Publish metadata.opf in `dir` through a hidden partial, create-only: whatever is
 * already at that name (a file, a link to anything, a folder) is kept as it is.
 */
export async function writeOpfSidecar(dir: string, book: OpfMetadata, fileMode: number): Promise<OpfOutcome> {
  const target = path.join(dir, OPF_FILE_NAME);
  return withTargetLock(target, async () => {
    await removeStalePartials(dir, OPF_FILE_NAME);
    if (await fs.lstat(target).then(() => true, () => false)) return { outcome: 'kept', path: target };
    const bytes = Buffer.from(buildOpf(book), 'utf8');
    try {
      await writeFileAtomic(target, bytes, { mode: 'create' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { outcome: 'kept', path: target };
      throw error;
    }
    const stat = await fs.lstat(target, { bigint: true });
    const identity = { dev: stat.dev, ino: stat.ino };
    const digest = sha256(bytes);
    const permissions = await applyFileMode(target, fileMode);
    if (permissions.kind === 'missing') throw new Error(permissions.reason);
    return permissions.kind === 'refused'
      ? { outcome: 'written', path: target, identity, digest, warning: permissions.warning }
      : { outcome: 'written', path: target, identity, digest };
  });
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Remove the metadata.opf this run wrote, only while it still is that file: same dev/ino
 * AND the same bytes (Linux gives a freed inode number to the next new file at once, so
 * a replacement can carry the old numbers; one holding exactly our bytes loses nothing).
 */
export async function removeOwnOpf(written: Extract<OpfOutcome, { outcome: 'written' }>): Promise<boolean> {
  return withTargetLock(written.path, async () => {
    const stat = await fs.lstat(written.path, { bigint: true }).catch(() => null);
    if (!stat?.isFile() || !sameIdentity({ dev: stat.dev, ino: stat.ino }, written.identity)) return false;
    const now = await fs.readFile(written.path).catch(() => null);
    if (!now || sha256(now) !== written.digest) return false;
    await fs.unlink(written.path);
    return true;
  });
}
