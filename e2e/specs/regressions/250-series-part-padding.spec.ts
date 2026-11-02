/**
 * Component: E2E regression #250 ({seriesPart:00} pads the series part in path templates)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata. The fixture metadata must be the made-up
 * offline one (book martian = "Fixture Book Two"), and RMAB's own Audible/Audnexus lookups must fail (the
 * fake proxy refuses RMAB's CONNECTs), so the series seeded on the book row ("Fixture Saga", part 1) is
 * what the organizer uses and no real catalog data replaces it.
 * 1. Admin Settings > Paths: type `{primaryAuthor}/{series}/{seriesPart:00} - {title}`; the live preview
 *    pads the example part (`/The Mistborn Saga/01 - `); Test Paths; Save Settings (real PUT).
 * 2. The book row for martian is seeded with series "Fixture Saga", part "1"; a request with author
 *    "Test Author, Second Writer" runs through fake Prowlarr and fake qBittorrent to `downloaded`.
 * 3. On disk: `/media/audiobooks/Test Author/Fixture Saga/01 - Fixture Book Two`; the real Audiobookshelf
 *    scan finds the item there and reports its series and sequence.
 * 4. Paths tab screenshots at 1280 light, 1280 dark and 375 with the template typed ({seriesPart:00} row).
 */

import { test, expect } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackExecSync, writeEvidence } from '../../lib/harness';
import { MEDIA, psql, sqlStr } from './242-helpers';
import { absItemAt, deliver, pathsTabShots, setTemplateInUi } from './path-template-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.use({ storageState: evidencePath('storage-state.json') });

const TEMPLATE = '{primaryAuthor}/{series}/{seriesPart:00} - {title}';
const AUTHORS = 'Test Author, Second Writer';
const SERIES = 'Fixture Saga';
const FAKE_PROXY = 'http://fake-arr:9898';

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

test('#250: {seriesPart:00} typed in Paths files part 1 of a series as "01 - Title"', async ({ page, browser }) => {
  test.setTimeout(900_000);
  for (const service of ['abs', 'rmab']) {
    expect(printenv(service, 'HTTPS_PROXY'), `${service} must run with --overrides abs-fake-metadata`).toBe(FAKE_PROXY);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1. Real input path: keyboard into the template field, Test Paths, Save Settings.
  const ui = await setTemplateInUi(page, TEMPLATE);
  writeEvidence('250/settings.json', ui);
  expect(ui.preview[0], 'preview pads the example series part').toContain('/Brandon Sanderson/The Mistborn Saga/01 - ');
  expect(ui.preview.join('\n'), 'no literal variable left in the preview').not.toMatch(/\{(primaryAuthor|seriesPart)/);
  expect(ui.putStatus, 'PUT /api/admin/settings/paths').toBe(200);
  expect(ui.stored, 'stored audiobook_path_template').toBe(TEMPLATE);

  // 2. Seed the series on the book row, then deliver.
  const book = (await fakeArr.books()).martian;
  expect(book.title, 'run with --offline-fixtures (made-up fixture titles)').toMatch(/^Fixture Book /);
  psql(`insert into audiobooks (id, audible_asin, title, author, narrator, series, series_part, status, created_at, updated_at)
        values (gen_random_uuid()::text, ${sqlStr(book.asin)}, ${sqlStr(book.title)}, ${sqlStr(AUTHORS)}, ${sqlStr(book.narrator)},
                ${sqlStr(SERIES)}, '1', 'requested', now(), now())`);
  const rmab = await Rmab.loginAdmin();
  const d = await deliver(rmab, {
    bookKey: 'martian',
    fixture: 'martian-mp3',
    author: AUTHORS,
    releaseTitle: `${AUTHORS} - {{title}} (Unabridged) [MP3 64kbps]`,
    scenario: 'series-part-250',
  });
  writeEvidence('250/delivered.json', d);
  expect(['downloaded', 'available'], `request status ${d.status}`).toContain(d.status);
  expect(d.series, 'series kept on the book row').toBe(SERIES);
  expect(d.seriesPart, 'series part kept on the book row').toBe('1');

  // 3. On disk and in Audiobookshelf.
  const rel = `Test Author/${SERIES}/01 - ${d.book.title}`;
  const expected = `${MEDIA}/${rel}`;
  const tree = stackExecSync('rmab', ['find', MEDIA, '-maxdepth', '4']).trim().split('\n').sort();
  writeEvidence('250/media-tree.txt', `${tree.join('\n')}\n`);
  const abs = await absItemAt(rel);
  writeEvidence('250/abs-item.json', abs);
  writeEvidence('250/result.json', { expected, filePath: d.filePath, abs });

  expect.soft(d.filePath, 'audiobooks.file_path').toBe(expected);
  expect.soft(tree.some((p) => p.startsWith(`${expected}/`) && p.endsWith('.mp3')), 'audio files under the padded folder').toBe(true);
  expect.soft(tree.filter((p) => p.includes('Second Writer')), 'no folder named after the second author').toEqual([]);
  expect.soft(abs.found, `ABS item at ${rel} (ABS items: ${abs.allRelPaths.join(', ')})`).toBe(true);
  expect.soft(abs.series.map((s) => s.name), 'ABS series').toContain(SERIES);
  expect.soft(Number(abs.series.find((s) => s.name === SERIES)?.sequence), 'ABS series sequence').toBe(1);

  // 4. Screenshots of the Paths tab with the template typed.
  await pathsTabShots(browser, '250', '250', TEMPLATE);
});
