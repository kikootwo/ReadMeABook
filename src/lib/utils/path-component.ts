/**
 * Component: Path Component Byte Limit
 * Documentation: documentation/phase3/file-organization.md
 *
 * Filesystems limit one path component (a folder or file name) to 255 bytes,
 * not characters: Cyrillic takes 2 bytes per character in UTF-8, CJK 3 and
 * emoji 4. These helpers cut a finished component to fit. A component that
 * already fits is returned unchanged.
 */

/** Byte limit of one path component on ext4, XFS, Btrfs, ZFS and most others */
export const MAX_COMPONENT_BYTES = 255;

/**
 * Suffix of the copy the metadata tagger writes next to the file it tags
 * (`${file}.tmp`). A name RMAB creates and then tags must leave room for it.
 */
export const TAG_TEMP_SUFFIX = '.tmp';

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Cut a folder or file name to at most `maxBytes` UTF-8 bytes. The cut falls
 * between grapheme clusters, so a multi-byte character, a surrogate pair, an
 * accented letter, a flag or a joined emoji is never split. Trailing spaces
 * and dots are trimmed from the cut name.
 */
export function capComponentBytes(name: string, maxBytes: number = MAX_COMPONENT_BYTES): string {
  if (utf8Bytes(name) <= maxBytes) return name;
  let kept = '';
  let bytes = 0;
  for (const { segment } of graphemes.segment(name)) {
    const size = utf8Bytes(segment);
    if (bytes + size > maxBytes) break;
    kept += segment;
    bytes += size;
  }
  return kept.replace(/[ .]+$/, '');
}

/**
 * Join `stem` and `suffix` (e.g. " - 3.mp3" or ".m4b") into a file name of at
 * most `maxBytes` bytes, cutting only the stem so the suffix is kept whole.
 * Returns `${stem}${suffix}` unchanged when it fits. A suffix too long to
 * leave room for any stem is cut along with the rest of the name.
 */
export function capFilenameBytes(stem: string, suffix: string, maxBytes: number = MAX_COMPONENT_BYTES): string {
  const full = `${stem}${suffix}`;
  if (utf8Bytes(full) <= maxBytes) return full;
  const room = maxBytes - utf8Bytes(suffix);
  if (room <= 0) return capComponentBytes(full, maxBytes);
  return `${capComponentBytes(stem, room)}${suffix}`;
}

/**
 * Cap every component of a '/'-separated relative path; components left
 * empty by the cut are dropped.
 */
export function capPathComponents(relativePath: string, maxBytes: number = MAX_COMPONENT_BYTES): string {
  return relativePath
    .split('/')
    .map((part) => capComponentBytes(part, maxBytes))
    .filter((part) => part.length > 0)
    .join('/');
}
