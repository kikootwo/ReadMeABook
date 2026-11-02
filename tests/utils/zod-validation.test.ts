/**
 * Component: Request Validation Helpers Tests
 * Documentation: documentation/backend/validation.md
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  MAX_VALIDATION_ISSUES,
  boundedArray,
  errorForLog,
  zodIssueDetails,
  type ValidationIssueDetail,
} from '@/lib/utils/zod-validation';
import { goodreadsRssUrlSchema } from '@/lib/utils/goodreads-rss-url.schema';
import { NOTIFICATION_EVENT_KEYS } from '@/lib/constants/notification-events';

const Item = z.object({ name: z.string(), count: z.number().int() });

/** Fields `details` may carry; anything else (e.g. `input`) must never be returned. */
const DETAIL_KEYS = ['code', 'path', 'message', 'origin', 'minimum', 'maximum', 'inclusive', 'expected', 'format', 'values'];

function issuesOf(schema: z.ZodType, value: unknown): z.core.$ZodIssue[] {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected a validation failure');
  return result.error.issues;
}

/** The issues as returned to the client (zodIssueDetails). */
function detailsOf(schema: z.ZodType, value: unknown): ValidationIssueDetail[] {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected a validation failure');
  return zodIssueDetails(result.error);
}

/** A 10^6-element array that counts reads of its elements. */
function countingList() {
  const reads = { count: 0 };
  const list = new Proxy(new Array(1_000_000).fill(1), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.count++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { list, reads };
}

describe('boundedArray', () => {
  it('parses an in-bounds array like z.array', () => {
    const value = [{ name: 'a', count: 1 }, { name: 'b', count: 2 }];
    expect(boundedArray(Item, 5).parse(value)).toEqual(z.array(Item).parse(value));
  });

  it('keeps the element issue paths and messages for an in-bounds invalid array', () => {
    const value = [{ name: 'a', count: 1 }, { name: 2, count: 1.5 }];
    expect(issuesOf(boundedArray(Item, 5), value)).toEqual(issuesOf(z.array(Item), value));
  });

  it('reports a non-array exactly like z.array', () => {
    expect(issuesOf(boundedArray(Item, 5), 'nope')).toEqual(issuesOf(z.array(Item), 'nope'));
  });

  it('gives one length issue, and no element issues, for max + 1 invalid elements', () => {
    const issues = issuesOf(boundedArray(Item, 5), Array.from({ length: 6 }, () => 1));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'too_big', origin: 'array', maximum: 5, path: [] });
  });

  it('reports an over-long array exactly like z.array().max()', () => {
    const value = Array.from({ length: 6 }, (_, i) => ({ name: `n${i}`, count: i }));
    expect(issuesOf(boundedArray(Item, 5), value)).toEqual(issuesOf(z.array(Item).max(5), value));
    expect(detailsOf(boundedArray(Item, 5), value)).toEqual(detailsOf(z.array(Item).max(5), value));
  });

  it('gives one length issue for a very large invalid array, quickly', () => {
    // performance.now is monotonic; Date.now can step inside a container VM
    const started = performance.now();
    const issues = issuesOf(boundedArray(Item, 5), new Array(100_000).fill(1));
    expect(issues).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('rejects a 10^6-element array without visiting any element', () => {
    const visit = vi.fn(() => true);
    const schema = boundedArray(z.custom<number>(visit), 5);
    const { list, reads } = countingList();
    const issues = issuesOf(schema, list);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'too_big', maximum: 5 });
    expect(reads.count).toBe(0);
    expect(visit).not.toHaveBeenCalled();
    expect(schema.parse([1, 2])).toEqual([1, 2]);
    expect(visit).toHaveBeenCalledTimes(2);
  });

  it('checks the minimum before element parsing', () => {
    const visit = vi.fn(() => true);
    const short = issuesOf(boundedArray(z.custom<number>(visit), 5, { min: 3 }), [1, 2]);
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({ code: 'too_small', minimum: 3 });
    expect(visit).not.toHaveBeenCalled();
    const parentCheck = vi.fn(() => true);
    z.object({ list: boundedArray(z.custom<number>(visit), 5, { min: 3 }) }).refine(parentCheck).safeParse({ list: [1, 2] });
    expect(parentCheck).not.toHaveBeenCalled();
    expect(visit).not.toHaveBeenCalled();
    const schema = boundedArray(Item, 5, { min: 1 });
    expect(issuesOf(schema, [])).toEqual(issuesOf(z.array(Item).min(1), []));
    expect(schema.parse([{ name: 'a', count: 1 }])).toHaveLength(1);
  });

  it('keeps the issue path inside an object schema', () => {
    const schema = z.object({ items: boundedArray(Item, 2) });
    const issues = issuesOf(schema, { items: [1, 1, 1] });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['items']);
  });

  it('does not run a parent refinement on an out-of-bounds list', () => {
    const refine = vi.fn((value: { items?: unknown[] }) => (value.items ?? []).every((item) => item !== null));
    const schema = z.object({ items: boundedArray(Item, 2).optional() }).refine(refine);
    const issues = issuesOf(schema, { items: [1, 1, 1] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'too_big', path: ['items'] });
    expect(refine).not.toHaveBeenCalled();
    expect(schema.parse({ items: [{ name: 'a', count: 1 }] })).toEqual({ items: [{ name: 'a', count: 1 }] });
    expect(refine).toHaveBeenCalledTimes(1);
  });

  it('removes duplicates with unique, after checking the input length', () => {
    const schema = boundedArray(z.enum(['a', 'b', 'c']), 3, { min: 1, unique: true });
    expect(schema.parse(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(issuesOf(schema, ['a', 'a', 'a', 'a'])[0]).toMatchObject({ code: 'too_big', maximum: 3 });
    expect(boundedArray(z.string(), 3).parse(['a', 'a'])).toEqual(['a', 'a']);
  });
});

// Dependency canary: zod 4.6.6+ stops at a leading .max() before reading any element.
// Fails if the installed zod is older (the length issue is reported, then every element is parsed).
describe('zod array max check (installed zod version)', () => {
  it('rejects a 10^6-element array over .max() with one issue and no element reads', () => {
    const { list, reads } = countingList();
    const issues = issuesOf(z.array(z.string()).max(10), list);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'too_big', maximum: 10, path: [] });
    expect(reads.count).toBe(0);
  });

  it('does the same for an array inside an object schema', () => {
    const { list, reads } = countingList();
    const issues = issuesOf(z.object({ list: z.array(z.string()).max(10) }), { list });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'too_big', maximum: 10, path: ['list'] });
    expect(reads.count).toBe(0);
  });
});

describe('zodIssueDetails', () => {
  it('caps the returned issues and keeps their shape', () => {
    const error = z.array(z.string()).safeParse(new Array(500).fill(1)).error!;
    const details = zodIssueDetails(error);
    expect(details).toHaveLength(MAX_VALIDATION_ISSUES);
    expect(details[0]).toEqual(error.issues[0]);
  });

  it('returns every issue when under the cap', () => {
    const error = Item.safeParse({}).error!;
    expect(zodIssueDetails(error)).toEqual(error.issues);
  });

  it('returns no internal flags or input for a boundedArray length issue', () => {
    const [detail] = detailsOf(boundedArray(Item, 1), [1, 2]);
    for (const key of ['continue', 'fatal', 'input', 'inst']) expect(detail).not.toHaveProperty(key);
    const native = detailsOf(z.array(Item).max(1), [{ name: 'a', count: 1 }, { name: 'b', count: 2 }])[0];
    expect(Object.keys(detail).sort()).toEqual(Object.keys(native).sort());
  });

  it('leaves out the input even when the issue carries it', () => {
    const long = 'Q'.repeat(10_000);
    const error = z.object({ n: z.number() }).safeParse({ n: long }, { reportInput: true }).error!;
    expect(error.issues[0]).toHaveProperty('input', long);
    const [detail] = zodIssueDetails(error);
    expect(detail).toEqual({ code: 'invalid_type', path: ['n'], message: error.issues[0].message, expected: 'number' });
  });

  it('cuts a message over 500 characters', () => {
    const [detail] = detailsOf(z.string().refine(() => false, { message: 'm'.repeat(600) }), 'x');
    expect(detail.message).toBe(`${'m'.repeat(500)}...`);
  });

  // Every issue code the request schemas can raise, each with a 10,000-character input
  const long = 'Q'.repeat(10_000);
  const cases: Array<[string, string, () => z.ZodType, unknown]> = [
    ['invalid_type', 'string input', () => z.object({ n: z.number() }), { n: long }],
    ['invalid_type', 'object input', () => z.object({ n: z.string() }), { n: { big: long } }],
    ['too_big', 'string', () => z.object({ s: z.string().max(100) }), { s: long }],
    ['too_small', 'string', () => z.object({ s: z.string().min(20_000) }), { s: long }],
    ['too_big', 'array', () => z.object({ list: boundedArray(z.string(), 2) }), { list: [long, long, long] }],
    ['too_small', 'array', () => z.object({ list: boundedArray(z.string(), 5, { min: 2 }) }), { list: [long] }],
    ['invalid_value', 'enum', () => z.object({ e: z.enum(['a', 'b']) }), { e: long }],
    ['invalid_format', 'url', () => z.object({ u: z.string().url() }), { u: long }],
    ['invalid_format', 'regex', () => z.object({ asin: z.string().regex(/^[A-Z0-9]{10}$/, 'Invalid author ASIN') }), { asin: long }],
    ['invalid_format', 'datetime', () => z.object({ d: z.string().datetime() }), { d: long }],
    ['invalid_format', 'guid', () => z.object({ id: z.string().guid() }), { id: long }],
    ['custom', '.refine', () => z.object({ t: z.string().refine((v) => v.length < 5, { message: 'Unsupported type' }) }), { t: long }],
    ['custom', 'Goodreads transform', () => z.object({ rssUrl: goodreadsRssUrlSchema }), { rssUrl: long }],
  ];

  it.each(cases)('returns no part of the input for %s (%s)', (code, _label, schema, value) => {
    const details = detailsOf(schema(), value);
    expect(details).toHaveLength(1);
    expect(details[0].code).toBe(code);
    for (const key of Object.keys(details[0])) expect(DETAIL_KEYS).toContain(key);
    const json = JSON.stringify(details);
    expect(json).not.toContain('QQQQQQQQ');
    expect(json.length).toBeLessThan(300);
  });

  it('keeps the full message for the notification events enum, without the input', () => {
    const schema = z.object({ events: boundedArray(z.enum(NOTIFICATION_EVENT_KEYS), NOTIFICATION_EVENT_KEYS.length, { min: 1 }) });
    const error = schema.safeParse({ events: ['Q'.repeat(5000)] }).error!;
    const [detail] = zodIssueDetails(error);
    expect(detail.message).toBe(error.issues[0].message);
    expect(detail.message).toContain(NOTIFICATION_EVENT_KEYS.map((key) => `"${key}"`).join('|'));
    expect(detail.message).not.toContain('QQQQQQQQ');
    expect(detail.message.length).toBeLessThan(500);
    expect(detail.values).toEqual(NOTIFICATION_EVENT_KEYS);
  });
});

describe('errorForLog', () => {
  it('summarizes a ZodError by issue count and first paths, without the full message', () => {
    const error = z.object({ list: z.array(z.string()) }).safeParse({ list: new Array(1000).fill(1) }).error!;
    const line = errorForLog(error);
    expect(line).toBe('Validation failed: 1000 issue(s) at list.0, list.1, list.2, ...');
    expect(line.length).toBeLessThan(200);
    expect(line).not.toContain(error.issues[0].message);
  });

  it('labels a root-level issue', () => {
    expect(errorForLog(z.string().safeParse(1).error!)).toBe('Validation failed: 1 issue(s) at (root)');
  });

  it('truncates a long path', () => {
    const key = 'k'.repeat(500);
    const error = z.object({ [key]: z.string() }).safeParse({}).error!;
    const line = errorForLog(error);
    expect(line).toContain(`${'k'.repeat(100)}...`);
    expect(line).not.toContain('k'.repeat(101));
  });

  it('returns the message of other errors', () => {
    expect(errorForLog(new Error('boom'))).toBe('boom');
    expect(errorForLog('plain')).toBe('plain');
  });
});
