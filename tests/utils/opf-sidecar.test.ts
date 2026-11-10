/**
 * Component: OPF Sidecar Tests
 * Documentation: documentation/features/library-placement.md
 *
 * Output is parsed with xml2js defaults, as Audiobookshelf parses it, and checked for
 * the shapes its OPF parser needs.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOpf, removeOwnOpf, splitPersonNames, writeOpfSidecar, xmlText, type OpfMetadata } from '@/lib/utils/opf-sidecar';

const BOOK: OpfMetadata = {
  title: 'Example Book',
  author: 'Ann Writer, Ben Co-Writer',
  narrator: 'Cara Reader',
  year: 2021,
  asin: 'B000000000',
  series: 'Example Saga',
  seriesPart: '1.5',
  description: 'Rock & roll <not a tag>',
  genres: ['Science Fiction & Fantasy', 'Mystery/Thriller'],
  publisher: 'Example Audio',
  subtitle: 'A Subtitle',
  language: 'english',
};

type Parsed = { package: { metadata: Array<Record<string, unknown>> } };
const parse = async (xml: string) => ((await parseStringPromise(xml)) as Parsed).package.metadata[0];

describe('buildOpf', () => {
  it('writes every field in the shape Audiobookshelf reads', async () => {
    const xml = buildOpf(BOOK);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<package ')).toBe(true);
    expect(xml).not.toMatch(/<!DOCTYPE|<!ENTITY|CDATA|dc:tag/);
    const m = await parse(xml);
    expect(m['dc:title']).toEqual(['Example Book']);
    expect(m['dc:subtitle']).toEqual(['A Subtitle']);
    // Creators are objects with $ and _ (ABS ignores a creator without attributes)
    expect(m['dc:creator']).toEqual([
      { _: 'Ann Writer', $: { 'opf:role': 'aut' } },
      { _: 'Ben Co-Writer', $: { 'opf:role': 'aut' } },
      { _: 'Cara Reader', $: { 'opf:role': 'nrt' } },
    ]);
    expect(m['dc:publisher']).toEqual(['Example Audio']);
    expect(m['dc:date']).toEqual(['2021']);
    expect(m['dc:language']).toEqual(['English']);
    expect(m['dc:identifier']).toEqual([{ _: 'B000000000', $: { 'opf:scheme': 'ASIN' } }]);
    expect(m['dc:description']).toEqual(['Rock & roll <not a tag>']);
    // Subjects are plain strings ('/' inside a genre becomes ' & ', as in the tags)
    expect(m['dc:subject']).toEqual(['Science Fiction & Fantasy', 'Mystery & Thriller']);
    // series_index right after series
    expect(m.meta).toEqual([
      { $: { name: 'calibre:series', content: 'Example Saga' } },
      { $: { name: 'calibre:series_index', content: '1.5' } },
    ]);
  });

  it('leaves out empty fields and is deterministic', async () => {
    const xml = buildOpf({ title: 'Only Title', author: '' });
    expect(buildOpf({ title: 'Only Title', author: '' })).toBe(xml);
    const m = await parse(xml);
    expect(Object.keys(m)).toEqual(['dc:title']);
  });

  it('writes no series index without a series, and no date for a year that is not 4 digits', async () => {
    const m = await parse(buildOpf({ title: 'T', author: 'A', seriesPart: '3', year: 999 }));
    expect(m.meta).toBeUndefined();
    expect(m['dc:date']).toBeUndefined();
  });

  it.each([
    ['element injection', '</dc:title><dc:creator opf:role="aut">X'],
    ['DTD and entity', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>&e;'],
    ['CDATA end', ']]>'],
    ['quotes', `"double" and 'single'`],
    ['a literal entity', '&amp; stays as typed'],
    ['emoji and RTL', 'Book 📚 עברית'],
  ])('hostile text (%s) in every field parses back as text and adds no element', async (_label, text) => {
    const hostile: OpfMetadata = {
      title: text, author: text, narrator: text, asin: text, series: text, seriesPart: text,
      description: text, genres: [text], publisher: text, subtitle: text, language: text,
    };
    const m = await parse(buildOpf(hostile));
    expect(Object.keys(m).sort()).toEqual(
      ['dc:creator', 'dc:description', 'dc:identifier', 'dc:language', 'dc:publisher', 'dc:subject', 'dc:subtitle', 'dc:title', 'meta'].sort()
    );
    expect(m['dc:title']).toEqual([text.trim()]);
    expect(m['dc:identifier'][0]._).toBe(text.trim());
    expect(m.meta[0].$.content).toBe(text.trim());
  });

  it('drops characters XML 1.0 cannot hold, so a strict parser still reads the file', async () => {
    const text = `A\u0001B\u0008C\u000BD￾E￿F\uD800G`;
    const xml = buildOpf({ title: text, author: 'X', description: text });
    const m = await parse(xml);
    expect(m['dc:title']).toEqual(['ABCDEF�G']);
  });

  it('caps the description at the tag limit', async () => {
    const m = await parse(buildOpf({ title: 'T', author: 'A', description: 'word '.repeat(10000) }));
    expect(Buffer.byteLength(m['dc:description'][0], 'utf8')).toBeLessThanOrEqual(16 * 1024);
  });
});

describe('xmlText', () => {
  it('escapes the five predefined entities', () => {
    expect(xmlText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('splitPersonNames', () => {
  it('splits on , ; & and keeps a suffix with its name', () => {
    expect(splitPersonNames('Martin Luther King, Jr.')).toEqual(['Martin Luther King, Jr.']);
    expect(splitPersonNames('Ann Writer, Ben Co-Writer; Cara & Dan')).toEqual(['Ann Writer', 'Ben Co-Writer', 'Cara', 'Dan']);
    expect(splitPersonNames('John Smith, Sr., Jane Doe, PhD')).toEqual(['John Smith, Sr.', 'Jane Doe, PhD']);
    expect(splitPersonNames('Henry Ford III, Ann Lee, MD')).toEqual(['Henry Ford III', 'Ann Lee, MD']);
    expect(splitPersonNames('Louis XIV, II')).toEqual(['Louis XIV, II']);
  });

  it('dedupes, drops empty entries and caps at 20', () => {
    expect(splitPersonNames('A, a, , B')).toEqual(['A', 'B']);
    expect(splitPersonNames(Array.from({ length: 30 }, (_, i) => `N${i}`).join(', '))).toHaveLength(20);
    expect(splitPersonNames(undefined)).toEqual([]);
  });
});

describe('writeOpfSidecar', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-opf-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes metadata.opf create-only, with the file mode, and leaves no partial', async () => {
    const outcome = await writeOpfSidecar(dir, BOOK, 0o640);
    expect(outcome.outcome).toBe('written');
    expect(fs.readFileSync(path.join(dir, 'metadata.opf'), 'utf8')).toBe(buildOpf(BOOK));
    expect(fs.readdirSync(dir)).toEqual(['metadata.opf']);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'metadata.opf')).mode & 0o777).toBe(0o640);
  });

  it('keeps an existing metadata.opf, even a hard link to a seeding file, byte for byte', async () => {
    const seed = path.join(dir, 'seed.opf');
    fs.writeFileSync(seed, 'SEED BYTES');
    fs.linkSync(seed, path.join(dir, 'metadata.opf'));
    const before = fs.statSync(seed);
    expect((await writeOpfSidecar(dir, BOOK, 0o664)).outcome).toBe('kept');
    expect(fs.readFileSync(seed, 'utf8')).toBe('SEED BYTES');
    expect(fs.statSync(seed).mtimeMs).toBe(before.mtimeMs);
  });

  it('removes only its own file', async () => {
    const outcome = await writeOpfSidecar(dir, BOOK, 0o664);
    if (outcome.outcome !== 'written') throw new Error('not written');
    // Replaced meanwhile: stays
    fs.rmSync(outcome.path);
    fs.writeFileSync(outcome.path, 'someone else');
    expect(await removeOwnOpf(outcome)).toBe(false);
    expect(fs.existsSync(outcome.path)).toBe(true);
    fs.rmSync(outcome.path);
    const again = await writeOpfSidecar(dir, BOOK, 0o664);
    if (again.outcome !== 'written') throw new Error('not written');
    expect(await removeOwnOpf(again)).toBe(true);
    expect(fs.existsSync(again.path)).toBe(false);
  });
});
