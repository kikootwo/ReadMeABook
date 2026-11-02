/**
 * Component: E2E regression #273 ({primaryAuthor} path template variable)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata. The fixture metadata must be the made-up
 * offline one (title "Fixture Book One", author "Test Author"), and RMAB's own Audible/Audnexus lookups
 * must fail (the fake proxy refuses RMAB's CONNECTs), so the two-author string sent with the request is
 * what the organizer uses and no real catalog data replaces it.
 * 1. Admin Settings > Paths: type `{primaryAuthor}/{title}` in the audiobook template; the live preview
 *    shows the first author and no literal `{primaryAuthor}`; Test Paths; Save Settings (real PUT).
 * 2. Request book phm with author "Test Author, Second Writer"; it runs through fake Prowlarr and fake
 *    qBittorrent to `downloaded`.
 * 3. The folder on disk is `/media/audiobooks/Test Author/Fixture Book One` (first author only), no folder
 *    carries the second author, and the real Audiobookshelf scan finds the item there.
 * 4. Paths tab screenshots at 1280 light, 1280 dark and 375 with the template typed.
 */

import { test, expect } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, stackExecSync, writeEvidence } from '../../lib/harness';
import { MEDIA } from './242-helpers';
import { absItemAt, deliver, pathsTabShots, setTemplateInUi } from './path-template-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.use({ storageState: evidencePath('storage-state.json') });

const TEMPLATE = '{primaryAuthor}/{title}';
const AUTHORS = 'Test Author, Second Writer';
const FAKE_PROXY = 'http://fake-arr:9898';

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

test('#273: {primaryAuthor} typed in Paths puts a two-author book under the first author only', async ({ page, browser }) => {
  test.setTimeout(900_000);
  for (const service of ['abs', 'rmab']) {
    expect(printenv(service, 'HTTPS_PROXY'), `${service} must run with --overrides abs-fake-metadata`).toBe(FAKE_PROXY);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1. Real input path: keyboard into the template field, Test Paths, Save Settings.
  const ui = await setTemplateInUi(page, TEMPLATE);
  writeEvidence('273/settings.json', ui);
  expect(ui.preview.length, 'preview lines').toBeGreaterThan(0);
  expect(ui.preview[0], 'preview shows the first example author').toContain('/media/audiobooks/Brandon Sanderson/');
  expect(ui.preview.join('\n'), 'no literal variable left in the preview').not.toContain('{primaryAuthor}');
  expect(ui.putStatus, 'PUT /api/admin/settings/paths').toBe(200);
  expect(ui.stored, 'stored audiobook_path_template').toBe(TEMPLATE);

  // 2. Deliver a two-author request.
  const rmab = await Rmab.loginAdmin();
  const d = await deliver(rmab, {
    bookKey: 'phm',
    fixture: 'phm-mp3',
    author: AUTHORS,
    releaseTitle: `${AUTHORS} - {{title}} (Unabridged) [MP3 64kbps]`,
    scenario: 'primary-author-273',
  });
  writeEvidence('273/delivered.json', d);
  expect(d.author, 'the book row keeps both authors').toBe(AUTHORS);
  expect(['downloaded', 'available'], `request status ${d.status}`).toContain(d.status);

  // 3. On disk and in Audiobookshelf.
  const expected = `${MEDIA}/Test Author/${d.book.title}`;
  const tree = stackExecSync('rmab', ['find', MEDIA, '-maxdepth', '3']).trim().split('\n').sort();
  writeEvidence('273/media-tree.txt', `${tree.join('\n')}\n`);
  const abs = await absItemAt(`Test Author/${d.book.title}`);
  writeEvidence('273/abs-item.json', abs);
  writeEvidence('273/result.json', { expected, filePath: d.filePath, mediaTopLevel: tree.filter((p) => p.split('/').length === 4), abs });

  expect.soft(d.filePath, 'audiobooks.file_path').toBe(expected);
  expect.soft(tree.some((p) => p.startsWith(`${expected}/`) && p.endsWith('.mp3')), 'audio files under the first-author folder').toBe(true);
  expect.soft(tree.filter((p) => p.includes('Second Writer')), 'no folder named after the second author').toEqual([]);
  expect.soft(abs.found, `ABS item at Test Author/${d.book.title} (ABS items: ${abs.allRelPaths.join(', ')})`).toBe(true);

  // 4. Screenshots of the Paths tab with the template typed.
  await pathsTabShots(browser, '273', '273', TEMPLATE);
});
