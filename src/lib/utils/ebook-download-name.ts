/**
 * Component: E-book Direct Download File Name
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Builds the `Title - Author.format` name an Anna's Archive download job is
 * queued with (`addStartDirectDownloadJob`). Every caller that queues one uses
 * this, so long names are cut the same way everywhere (#474).
 */

import { capTitleAuthorBytes, MAX_COMPONENT_BYTES } from './path-component';

/**
 * Longest extension the downloader can swap in for the queued one
 * (`.epub`, `.mobi`, `.azw3`, `.djvu`): the processor replaces the queued
 * extension with the format of the file it finds.
 */
const LONGEST_EBOOK_EXTENSION_BYTES = 5;

function clean(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, ' ') // Collapse spaces
    .trim();
}

/**
 * `Title - Author.format`, at most 255 UTF-8 bytes even after the downloader
 * swaps in a longer extension. The title is cut first and the author kept
 * whole unless the title would get under half the room (`capTitleAuthorBytes`).
 * A name that fits is the plain join, with invalid characters removed and
 * spaces collapsed as the downloader does.
 */
export function buildEbookDownloadName(title: string, author: string, format: string): string {
  const suffix = `.${format}`;
  const extensionRoom = Math.max(0, LONGEST_EBOOK_EXTENSION_BYTES - Buffer.byteLength(suffix, 'utf8'));
  return capTitleAuthorBytes(clean(title), clean(author), ' - ', suffix, MAX_COMPONENT_BYTES - extensionRoom);
}
