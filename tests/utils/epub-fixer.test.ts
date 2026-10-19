/**
 * Component: EPUB Kindle Fixer Round-trip Pins
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Builds a tiny EPUB in the test (no third-party content), runs fixEpubForKindle
 * on the real filesystem, and pins the archive structure and fixed content, so
 * a zip-library upgrade (adm-zip) that changes either fails here.
 */

import AdmZip from 'adm-zip';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async () => null }) }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }), forJob: vi.fn() },
}));

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">test-book</dc:identifier>
    <dc:title>Test Book</dc:title>
    <dc:language>english</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;

// No XML declaration; links to a #body fragment; one img without src
const CH1 = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>
<body id="body"><p>Café 日本 — <a href="ch2.xhtml#body">next</a></p><img alt="x"/><img src="pic.png" alt="ok"/></body></html>`;

// Declaration without encoding
const CH2 = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body><p>Two</p></body></html>`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0xff]);

// adm-zip (0.5.x and 0.6.x alike) writes entries sorted by name (case-insensitive), so
// `mimetype` is NOT the first entry even though the EPUB container spec asks for it. Pinned
// as-is; a zip-library change to ordering shows up here and should be reviewed, not just updated.
const ENTRY_ORDER = ['META-INF/container.xml', 'mimetype', 'OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/content.opf', 'OEBPS/pic.png'];

describe('fixEpubForKindle round trip', () => {
  let dir: string;
  let source: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-epub-'));
    source = path.join(dir, 'Test Book.epub');
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    zip.getEntry('mimetype')!.header.method = 0; // EPUB rule: first entry, stored
    zip.addFile('META-INF/container.xml', Buffer.from(CONTAINER));
    zip.addFile('OEBPS/content.opf', Buffer.from(OPF));
    zip.addFile('OEBPS/ch1.xhtml', Buffer.from(CH1));
    zip.addFile('OEBPS/ch2.xhtml', Buffer.from(CH2));
    zip.addFile('OEBPS/pic.png', PNG);
    zip.writeZip(source);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes a fixed copy with the same entries and the expected fixes', async () => {
    const { fixEpubForKindle } = await import('@/lib/utils/epub-fixer');
    const result = await fixEpubForKindle(source, dir);

    expect(result).toMatchObject({
      success: true,
      fixesApplied: { encodingFixes: 2, bodyIdLinkFixes: 1, languageFix: true, strayImgFixes: 1 },
    });
    expect(path.basename(result.outputPath!)).toBe('Test Book.epub');
    expect(result.outputPath).not.toBe(source);

    const fixed = new AdmZip(result.outputPath!);
    const entries = fixed.getEntries();
    expect(entries.map((e) => e.entryName)).toEqual(ENTRY_ORDER);

    const mimetype = fixed.getEntry('mimetype')!;
    expect(mimetype.getData().toString()).toBe('application/epub+zip');
    expect(mimetype.header.method).toBe(0);

    const ch1 = fixed.readAsText('OEBPS/ch1.xhtml');
    expect(ch1.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<html')).toBe(true);
    expect(ch1).toContain('href="ch2.xhtml"');
    expect(ch1).not.toContain('#body"');
    expect(ch1).not.toContain('<img alt="x"/>');
    expect(ch1).toContain('src="pic.png"');
    // Today: a file re-serialized by cheerio (stray-img fix) has non-ASCII text as numeric entities
    expect(ch1).toContain('Caf&#xe9; &#x65e5;&#x672c; &#x2014;');

    expect(fixed.readAsText('OEBPS/ch2.xhtml').startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(fixed.readAsText('OEBPS/content.opf')).toContain('<dc:language>en</dc:language>');
    expect(fixed.readAsText('META-INF/container.xml')).toBe(CONTAINER);
    expect(fixed.getEntry('OEBPS/pic.png')!.getData().equals(PNG)).toBe(true);

    // The source is left untouched
    expect(new AdmZip(source).readAsText('OEBPS/ch1.xhtml')).toBe(CH1);
  });

  it('reports a missing source without throwing', async () => {
    const { fixEpubForKindle } = await import('@/lib/utils/epub-fixer');
    const result = await fixEpubForKindle(path.join(dir, 'missing.epub'), dir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
