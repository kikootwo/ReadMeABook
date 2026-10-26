/**
 * Component: Multi-Disc Folder Rule (pure)
 * Documentation: documentation/features/multi-disc-folders.md
 *
 * One rule for books stored as `Book/Disc 1/`, `Book/Disc 2/`...: which folder
 * names are discs, when a folder is a multi-disc book, and the order its files
 * import in. Paths here are relative keys with '/' separators.
 */

export type DiscKind = 'disc' | 'part';

export interface DiscFolderName {
  kind: DiscKind;
  number: number;
}

/** `CD1`, `cd 01`, `CD-2`, `Disc 1`, `Disc_02`, `DISK 3`, `Disc 1 of 3`. */
const DISC_NAME_RE = /^(?:cd|disc|disk)[\s._-]*(\d{1,3})(?:\s+of\s+\d{1,3})?$/i;
/** `Part 1`, `Part 02`, `Part 1-2` (sorts by its first number). */
const PART_NAME_RE = /^part[\s._-]*(\d{1,3})(?:\s*-\s*\d{1,3})?$/i;
/** Volumes are separate titles in a series: generic as a search term, never a disc. */
const VOLUME_NAME_RE = /^vol(?:ume)?\.?\s*\d+$/i;

/** Classify a folder name (trimmed, case-insensitive, the whole name). Null when it is not a disc. */
export function parseDiscFolderName(rawName: string): DiscFolderName | null {
  const name = rawName.trim();
  const disc = DISC_NAME_RE.exec(name);
  if (disc) return { kind: 'disc', number: parseInt(disc[1], 10) };
  const part = PART_NAME_RE.exec(name);
  if (part) return { kind: 'part', number: parseInt(part[1], 10) };
  return null;
}

/** Folder names that say nothing about the book (never used as an Audible search term). */
export function isGenericFolderName(rawName: string): boolean {
  return parseDiscFolderName(rawName) !== null || VOLUME_NAME_RE.test(rawName.trim());
}

/** Album title without a trailing disc suffix (`Book (Disc 2)`, `Book - CD 2`, `Book [Disc 1 of 3]`). Never `Part N`. */
export function stripDiscSuffix(album: string): string {
  const stripped = album
    .replace(/\s*(?:[-–—:,]\s*)?[([]?\s*(?:cd|disc|disk)[\s._-]*\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?\s*[)\]]?\s*$/i, '')
    .trim();
  return stripped || album.trim();
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural order (`2` before `10`), ties broken by the raw string so the result is stable. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export interface DiscGroup {
  /** The folder name exactly as it is on disk (paths are built from it). */
  name: string;
  kind: DiscKind;
  number: number;
  /** Keys of the audio files directly inside this folder. */
  files: string[];
}

export interface DiscLayout {
  /** Shared wrapper folders stripped before classifying (`Book/` in `Book/CD1/01.mp3`), with trailing '/'. */
  prefix: string;
  /** Audio directly in the book folder. */
  rootFiles: string[];
  /** Two or more disc folders, each holding audio directly. */
  discs: DiscGroup[];
  /** Audio anywhere else (non-disc subfolders, or deeper than a disc folder). */
  otherFiles: string[];
}

/** Shared leading folders of every key, when none of them is a disc folder. */
function wrapperPrefix(keys: string[]): string {
  let prefix = '';
  for (;;) {
    const rest = keys.map((k) => k.slice(prefix.length));
    if (rest.some((k) => !k.includes('/'))) return prefix;
    const first = rest[0].split('/')[0];
    if (parseDiscFolderName(first) || rest.some((k) => k.split('/')[0] !== first)) return prefix;
    prefix += `${first}/`;
  }
}

/**
 * The multi-disc layout of a set of audio keys (relative to the book folder),
 * or null when it is not one: fewer than two disc folders hold audio directly.
 * A disc folder counts only for audio directly inside it.
 */
export function resolveDiscLayout(keys: string[]): DiscLayout | null {
  if (keys.length < 2) return null;
  const prefix = wrapperPrefix(keys);
  const rootFiles: string[] = [];
  const otherFiles: string[] = [];
  const discs = new Map<string, DiscGroup>();
  for (const key of keys) {
    const segments = key.slice(prefix.length).split('/');
    const disc = segments.length === 2 ? parseDiscFolderName(segments[0]) : null;
    if (segments.length === 1) {
      rootFiles.push(key);
    } else if (disc) {
      const group = discs.get(segments[0]) ?? { name: segments[0], ...disc, files: [] };
      group.files.push(key);
      discs.set(segments[0], group);
    } else {
      otherFiles.push(key);
    }
  }
  if (discs.size < 2) return null;
  return { prefix, rootFiles, discs: [...discs.values()], otherFiles };
}

/** True when `ordered` holds exactly the items of `input` (same length, same set). */
export function isPermutation(input: string[], ordered: string[]): boolean {
  if (input.length !== ordered.length) return false;
  const counts = new Map<string, number>();
  for (const item of input) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of ordered) {
    const left = counts.get(item);
    if (!left) return false;
    counts.set(item, left - 1);
  }
  return true;
}

/** Track numbers 1..n, each once, for every file: the order they give, else null. */
function trackOrder(files: string[], trackOf: (key: string) => number | undefined): string[] | null {
  const tracks = files.map((key) => ({ key, track: trackOf(key) }));
  if (tracks.some((t) => !t.track || t.track < 1)) return null;
  const sorted = [...tracks].sort((a, b) => a.track! - b.track!);
  return sorted.every((t, i) => t.track === i + 1) ? sorted.map((t) => t.key) : null;
}

export interface OrderNotes {
  /** Disc folders sharing a number (`CD1` and `Disc 1`), ordered by name. */
  tiedNumbers: number[];
  /** Disc folders ordered by their track tags. */
  byTracks: string[];
}

/**
 * Import order of a multi-disc layout: the book folder's own files, then each
 * disc by number (its track tags when every file has one and they run 1..n,
 * else natural order), then any other files.
 */
export function orderDiscLayout(
  layout: DiscLayout,
  trackOf: (key: string) => number | undefined = () => undefined
): { order: string[]; notes: OrderNotes } {
  const notes: OrderNotes = { tiedNumbers: [], byTracks: [] };
  const discs = [...layout.discs].sort((a, b) => a.number - b.number || naturalCompare(a.name, b.name));
  discs.forEach((disc, i) => {
    if (i > 0 && discs[i - 1].number === disc.number && !notes.tiedNumbers.includes(disc.number)) {
      notes.tiedNumbers.push(disc.number);
    }
  });
  const natural = (files: string[]) => [...files].sort(naturalCompare);
  const order = [...natural(layout.rootFiles)];
  for (const disc of discs) {
    const byTags = trackOrder(disc.files, trackOf);
    if (byTags) notes.byTracks.push(disc.name);
    order.push(...(byTags ?? natural(disc.files)));
  }
  order.push(...natural(layout.otherFiles));
  return { order, notes };
}

/** The book's file set for Manual and Bulk Import: its own audio plus each disc folder's audio (keys). */
export function discBookFiles(layout: DiscLayout): string[] {
  return orderDiscLayout({ ...layout, otherFiles: [] }).order;
}

/**
 * Why a `selectedFiles` entry with a '/' is refused, or null when it is a
 * member of the book's file set. Entries are matched exactly: no normalizing.
 */
export function slashEntryProblem(entry: string, bookSet: ReadonlySet<string>): string | null {
  if (entry.includes('\0')) return 'contains a NUL byte';
  if (entry.includes('\\')) return 'contains a backslash';
  if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return 'is an absolute path';
  const segments = entry.split('/');
  if (segments.some((s) => s === '')) return 'has an empty path segment';
  if (segments.some((s) => s === '.' || s === '..')) return 'has a relative path segment';
  if (!bookSet.has(entry)) return 'is not an audio file in a disc folder of this book';
  return null;
}
