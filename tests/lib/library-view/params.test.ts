/**
 * Component: Library view params and cursor tests (strict validation)
 * Documentation: documentation/features/library-view.md
 */

import { describe, expect, it } from 'vitest';
import { parseLibraryParams } from '@/lib/library-view/params';
import { encodeCursor } from '@/lib/library-view/cursor';

const parse = (qs: string) => parseLibraryParams(new URLSearchParams(qs));
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

describe('parseLibraryParams', () => {
  it('defaults: added desc, no group, limit 60', () => {
    const r = parse('');
    expect(r.ok && !r.params.live && r.params).toMatchObject({ spec: { sort: 'added', order: 'desc', group: 'none' }, limit: 60, cursorTuple: null });
  });

  it('live=1 selects live mode; any other live value is refused', () => {
    expect(parse('live=1')).toEqual({ ok: true, params: { live: true } });
    expect(parse('live=true')).toMatchObject({ ok: false, error: 'ValidationError' });
  });

  it('group=author forces author asc whatever sort/order say', () => {
    const r = parse('group=author&sort=year&order=desc');
    expect(r.ok && !r.params.live && r.params.spec).toEqual({ sort: 'author', order: 'asc', group: 'author' });
  });

  it.each([
    ['status=available,bogus'],
    ['status='],
    ['source=plex'],
    ['source=scan,rmab,scan'],
    ['requestedBy=not-a-uuid'],
    [`requestedBy=${Array.from({ length: 51 }, (_, i) => uuid(i)).join(',')}`],
    ['hideAvailable=yes'],
    ['sort=size'],
    ['order=up'],
    ['group=series'],
    ['limit=0'],
    ['limit=121'],
    ['limit=1e2'],
    [`q=${'x'.repeat(201)}`],
  ])('400 ValidationError for %s', (qs) => {
    expect(parse(qs)).toMatchObject({ ok: false, error: 'ValidationError' });
  });

  it('accepts 50 requesters, q of 200 characters and folds q into tokens', () => {
    const r = parse(`requestedBy=${Array.from({ length: 50 }, (_, i) => uuid(i)).join(',')}&q=${encodeURIComponent('  Émile   KÄSTNER ')}`);
    expect(r.ok && !r.params.live && r.params.filters.tokens).toEqual(['emile', 'kastner']);
    expect(parse(`q=${'x'.repeat(200)}`).ok).toBe(true);
  });

  describe('cursor', () => {
    const scopeOf = (qs: string) => {
      const r = parse(qs);
      if (!r.ok || r.params.live) throw new Error('bad fixture');
      return r.params.scope;
    };

    it('round-trips a cursor issued for the same sort and filters', () => {
      const scope = scopeOf('sort=title&status=problem');
      const cursor = encodeCursor(scope, ['dune', 'req_abc-123']);
      const r = parse(`sort=title&status=problem&cursor=${cursor}`);
      expect(r.ok && !r.params.live && r.params.cursorTuple).toEqual(['dune', 'req_abc-123']);
    });

    it('StaleCursor when sort, order or filters changed', () => {
      const cursor = encodeCursor(scopeOf('sort=title&status=problem'), ['dune', 'req_abc-123']);
      expect(parse(`sort=title&status=denied&cursor=${cursor}`)).toMatchObject({ ok: false, error: 'StaleCursor' });
      expect(parse(`sort=title&order=desc&status=problem&cursor=${cursor}`)).toMatchObject({ ok: false, error: 'StaleCursor' });
    });

    it.each([
      ['not base64 !!'],
      ['x'.repeat(2049)],
      [Buffer.from('not json').toString('base64url')],
      [Buffer.from(JSON.stringify({ v: 2, s: 'added', o: 'desc', g: 'none', f: '0123456789abcdef', k: [1, 'req_a'] })).toString('base64url')],
      [Buffer.from(JSON.stringify({ v: 1, s: 'added', o: 'desc', g: 'none', f: '0123456789abcdef', k: ['x', 'req_a'] })).toString('base64url')],
      [Buffer.from(JSON.stringify({ v: 1, s: 'added', o: 'desc', g: 'none', f: '0123456789abcdef', k: [1, 'evil'] })).toString('base64url')],
      [Buffer.from(JSON.stringify({ v: 1, s: 'added', o: 'desc', g: 'none', f: '0123456789abcdef', k: [1, 'req_a'], x: 1 })).toString('base64url')],
    ])('BadCursor for a malformed cursor (%#)', (cursor) => {
      expect(parse(`cursor=${encodeURIComponent(cursor)}`)).toMatchObject({ ok: false, error: 'BadCursor' });
    });
  });
});
