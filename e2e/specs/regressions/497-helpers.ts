/**
 * Component: E2E #497 helpers (an ebook request's placement record, file bytes)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { asApp, psql, q, sh, sqlStr } from './library-delete-helpers';

export const LEGACY_REASON = 'RMAB has no record of the ebook files this request placed (it was imported before RMAB kept one, or the record could not be saved), so no ebook file was removed';
export const ALREADY_THERE_REASON = 'RMAB has no record that this request placed the ebook (its import found it already in the library), so it was not removed';

export function hasPlacedColumn(): boolean {
  return psql(`select count(*) from information_schema.columns where table_name = 'requests' and column_name = 'placed_ebook_files'`) === '1';
}

export interface Placement {
  path: string;
  size: number;
  sha256: string;
  placedAt: string;
}

/** requests.placed_ebook_files: 'no column', 'NULL' (SQL NULL), or the stored JSON. */
export function placedRecord(requestId: string): 'no column' | 'NULL' | Placement[] {
  if (!hasPlacedColumn()) return 'no column';
  const raw = psql(`select coalesce(placed_ebook_files::text, 'NULL') from requests where id = ${sqlStr(requestId)}`);
  return raw === 'NULL' ? 'NULL' : (JSON.parse(raw) as Placement[]);
}

/** A file of exactly `bytes` bytes, the word repeated (same size, different bytes for another word), owned by the app user. */
export function fillFile(dir: string, name: string, word: string, bytes = 4096) {
  asApp(`mkdir -p ${q(dir)}\nyes ${q(word)} | head -c ${bytes} > ${q(`${dir}/${name}`)}`);
}

export function sha256(file: string): string {
  return sh(`sha256sum ${q(file)} | cut -d' ' -f1`).trim();
}

export function requestRow(requestId: string): { status: string; completed: boolean; deleted: boolean } {
  return JSON.parse(
    psql(
      `select json_build_object('status', status, 'completed', completed_at is not null, 'deleted', deleted_at is not null)::text from requests where id = ${sqlStr(requestId)}`
    )
  );
}
