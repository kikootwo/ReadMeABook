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
} from '@/lib/utils/zod-validation';

const Item = z.object({ name: z.string(), count: z.number().int() });

function issuesOf(schema: z.ZodTypeAny, value: unknown): z.ZodIssue[] {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected a validation failure');
  return result.error.issues;
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
    expect(issues[0]).toMatchObject({ code: 'too_big', type: 'array', maximum: 5, path: [] });
  });

  it('reports an over-long array exactly like z.array().max()', () => {
    const value = Array.from({ length: 6 }, (_, i) => ({ name: `n${i}`, count: i }));
    expect(issuesOf(boundedArray(Item, 5), value)).toEqual(issuesOf(z.array(Item).max(5), value));
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
    let elementReads = 0;
    const list = new Proxy(new Array(1_000_000).fill(1), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) elementReads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const issues = issuesOf(schema, list);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'too_big', maximum: 5 });
    expect(elementReads).toBe(0);
    expect(visit).not.toHaveBeenCalled();
    expect(schema.parse([1, 2])).toEqual([1, 2]);
    expect(visit).toHaveBeenCalledTimes(2);
  });

  it('checks the minimum before element parsing', () => {
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
