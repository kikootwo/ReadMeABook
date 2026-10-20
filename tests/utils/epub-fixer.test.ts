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
import { writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
// adm-zip builds its methods per instance, so writes are intercepted through a thin wrapper:
// when `writeHook.bytes` is set, writeZip(target) writes those bytes instead of the archive.
const writeHook = vi.hoisted(() => ({ bytes: null as null | ((zip: any) => Buffer) }));
vi.mock('adm-zip', async (importOriginal) => {
  const Real = ((await importOriginal()) as { default: any }).default;
  function Wrapped(this: unknown, ...args: unknown[]) {
    const zip = new Real(...args);
    const realWrite = zip.writeZip.bind(zip);
    zip.writeZip = (target: string, ...rest: unknown[]) =>
      writeHook.bytes ? writeFileSync(target, writeHook.bytes(zip)) : realWrite(target, ...rest);
    return zip;
  }
  return { default: Wrapped };
});
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async () => null }) }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn() }), forJob: vi.fn() },
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

  describe('read-back verification of the written copy', () => {
    afterEach(() => {
      writeHook.bytes = null;
    });

    /** Make the fixer's writeZip produce `bytes(zip)` instead of the real archive. */
    function writeInstead(bytes: (zip: AdmZip) => Buffer) {
      writeHook.bytes = bytes;
    }

    async function fixAndExpectRejected(reason: RegExp) {
      const { fixEpubForKindle } = await import('@/lib/utils/epub-fixer');
      const result = await fixEpubForKindle(source, dir);

      expect(result).toMatchObject({ success: false, outputPath: null, verificationFailed: true });
      expect(result.error).toMatch(reason);
      // The bad copy and its temp folder are gone; the source is untouched
      expect((await fs.readdir(dir)).filter((n) => n.startsWith('kindle-fix-'))).toEqual([]);
      expect(new AdmZip(source).readAsText('OEBPS/ch1.xhtml')).toBe(CH1);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(reason));
      return result;
    }

    it('accepts a copy that reads back as written', async () => {
      const { fixEpubForKindle } = await import('@/lib/utils/epub-fixer');
      const result = await fixEpubForKindle(source, dir);

      expect(result.success).toBe(true);
      expect(result.verificationFailed).toBeUndefined();
    });

    it('rejects a truncated copy', async () => {
      writeInstead((zip) => {
        const full = zip.toBuffer();
        return full.subarray(0, Math.floor(full.length / 2));
      });
      await fixAndExpectRejected(/could not be opened or listed/);
    });

    it('rejects a copy whose entry data is corrupted, naming the entry and never its content', async () => {
      writeInstead((zip) => {
        const full = Buffer.from(zip.toBuffer());
        // mimetype is stored uncompressed, so its bytes appear verbatim in the archive
        const at = full.indexOf('application/epub+zip');
        expect(at).toBeGreaterThan(0);
        full[at + 3] ^= 0x20;
        return full;
      });
      const result = await fixAndExpectRejected(/entry "mimetype"/);
      expect(result.error).not.toMatch(/epub\+zip/);
    });

    it('rejects a copy whose central directory is damaged', async () => {
      writeInstead((zip) => {
        const full = Buffer.from(zip.toBuffer());
        // Break the signature of the first central directory header (PK)
        const cen = full.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        expect(cen).toBeGreaterThan(0);
        full[cen + 2] = 0x09;
        return full;
      });
      await fixAndExpectRejected(/could not be opened or listed/);
    });

    it('rejects a copy whose deflated entry data is damaged, naming the entry', async () => {
      writeInstead((zip) => {
        const full = Buffer.from(zip.toBuffer());
        const entry = new AdmZip(full).getEntry('OEBPS/ch1.xhtml')!;
        expect(entry.header.method).toBe(8); // deflated
        // Local header: 30 bytes + name + extra, then the compressed data
        const local = entry.header.offset;
        const dataStart = local + 30 + full.readUInt16LE(local + 26) + full.readUInt16LE(local + 28);
        full[dataStart + Math.floor(entry.header.compressedSize / 2)] ^= 0xff;
        return full;
      });
      await fixAndExpectRejected(/entry "OEBPS\/ch1\.xhtml"/);
    });

    it('removes its temp folder and reports a plain failure when writing throws', async () => {
      writeInstead(() => {
        throw new Error('ENOSPC: no space left on device, write');
      });
      const { fixEpubForKindle } = await import('@/lib/utils/epub-fixer');
      const result = await fixEpubForKindle(source, dir);

      expect(result).toMatchObject({ success: false, outputPath: null });
      expect(result.verificationFailed).toBeUndefined();
      expect(result.error).toContain('ENOSPC');
      expect((await fs.readdir(dir)).filter((n) => n.startsWith('kindle-fix-'))).toEqual([]);
    });

    it('gives concurrent runs separate temp folders', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      const { fixEpubForKindle } = await import('@/lib/utils/epub-fixer');
      const [a, b] = await Promise.all([fixEpubForKindle(source, dir), fixEpubForKindle(source, dir)]);
      now.mockRestore();

      expect(a.success && b.success).toBe(true);
      expect(path.dirname(a.outputPath!)).not.toBe(path.dirname(b.outputPath!));
      expect(new AdmZip(a.outputPath!).getEntries().length).toBe(ENTRY_ORDER.length);
      expect(new AdmZip(b.outputPath!).getEntries().length).toBe(ENTRY_ORDER.length);
    });

    it('rejects a valid archive whose entry differs from what the fixer meant to write', async () => {
      writeInstead((zip) => {
        const copy = new AdmZip(zip.toBuffer());
        copy.updateFile('OEBPS/ch2.xhtml', Buffer.from('tampered chapter text'));
        return copy.toBuffer();
      });
      const result = await fixAndExpectRejected(/entry "OEBPS\/ch2\.xhtml" does not match/);
      expect(result.error).not.toContain('tampered');
    });

    it('rejects a copy with a missing or an extra entry', async () => {
      writeInstead((zip) => {
        const copy = new AdmZip(zip.toBuffer());
        copy.deleteFile('OEBPS/pic.png');
        return copy.toBuffer();
      });
      await fixAndExpectRejected(/entry "OEBPS\/pic\.png" is missing/);

      writeInstead((zip) => {
        const copy = new AdmZip(zip.toBuffer());
        copy.addFile('OEBPS/extra.xhtml', Buffer.from('x'));
        return copy.toBuffer();
      });
      await fixAndExpectRejected(/unexpected entry "OEBPS\/extra\.xhtml"/);
    });
  });

  it('reports a missing source without throwing', async () => {
    const { fixEpubForKindle } = await import('@/lib/utils/epub-fixer');
    const result = await fixEpubForKindle(path.join(dir, 'missing.epub'), dir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
