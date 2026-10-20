/**
 * Component: EPUB Read-back Verification (Kindle fixer output)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The Kindle fixer records what it means to write, writes the zip, then re-opens the
 * file and compares. Only a copy that matches may be imported in place of the original.
 */

import AdmZip from 'adm-zip';
import { createHash } from 'crypto';

/** Entry name -> sha256 of its intended bytes (null for a directory entry). */
export function intendedEntries(zip: AdmZip): Map<string, string | null> {
  const intended = new Map<string, string | null>();
  for (const entry of zip.getEntries()) {
    intended.set(entry.entryName, entry.isDirectory ? null : sha256(entry.getData()));
  }
  return intended;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Re-open a written EPUB and compare it with what was meant to be written. Returns null
 * when it matches, or a reason naming the first entry that does not (never its content).
 * getData() also checks each entry's stored CRC and throws on corrupt or truncated data.
 */
export function verifyWrittenEpub(outputPath: string, intended: Map<string, string | null>): string | null {
  // adm-zip reads the central directory lazily: opening, listing and reading can each throw
  // on a damaged archive, so all of it is inside the try
  try {
    const written = new AdmZip(outputPath);
    const entries = written.getEntries();
    const names = new Set(entries.map((e) => e.entryName));
    for (const name of intended.keys()) {
      if (!names.has(name)) return `entry "${name}" is missing`;
    }
    for (const entry of entries) {
      if (!intended.has(entry.entryName)) return `unexpected entry "${entry.entryName}"`;
      const expected = intended.get(entry.entryName);
      if (expected === null) continue;
      let data: Buffer;
      try {
        data = entry.getData();
      } catch {
        return `entry "${entry.entryName}" could not be read back (CRC or data error)`;
      }
      if (sha256(data) !== expected) return `entry "${entry.entryName}" does not match what was written`;
    }
    if (entries.length !== intended.size) return 'the written archive has duplicate entries';
    return null;
  } catch {
    return 'the written archive could not be opened or listed';
  }
}
