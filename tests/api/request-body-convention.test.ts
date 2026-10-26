/**
 * Component: Request Body Convention Test
 * Documentation: documentation/backend/validation.md
 *
 * Route handlers, middleware and server libraries read request bodies only through readJsonBody
 * (src/lib/utils/request-body.ts), so every body read has a size limit.
 * Caught: a receiver whose name contains "req" (req, request, authReq, ctx.request, `(request as X)`)
 * calling json/text/formData/arrayBuffer/blob (`.x()`, `?.x()`, `.x?.()`, `["x"]()`), reading
 * `.body`/`.clone` on req/request/*Req/*Request, or destructuring those members from such a receiver;
 * calls split across lines are caught too. Not caught: a request aliased to a name without "req".
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED = new Set(['src/lib/utils/request-body.ts']);

const READ_METHODS = 'json|text|formData|arrayBuffer|blob';
/** Any identifier containing "req", or a parenthesised cast of one: `(request as NextRequest)`. */
const ANY_REQ = String.raw`(?:\b\w*req\w*|\(\w*req\w*\sas\s[\w.<>]+\))`;
/** req, request, authReq, nextRequest, ... (or a cast of one). */
const REQ_NAME = String.raw`(?:\b\w*[Rr]eq(?:uest)?|\(\w*[Rr]eq(?:uest)?\sas\s[\w.<>]+\))`;

const PATTERNS: RegExp[] = [
  // request.json(), request?.json(), request.json?.(), (request as X).json()
  new RegExp(String.raw`${ANY_REQ}\??\.(?:${READ_METHODS})(?:\?\.)?\(`, 'i'),
  // request["json"](), request?.['text']()
  new RegExp(String.raw`${ANY_REQ}\??\.?\[['"\x60](?:${READ_METHODS}|body|clone)['"\x60]\]`, 'i'),
  // request.body, request?.clone
  new RegExp(String.raw`${REQ_NAME}\??\.(?:body|clone)\b`),
  // const { body } = request; const { json: read } = req
  new RegExp(String.raw`\{[^{}=]*\b(?:${READ_METHODS}|body|clone)\b[^{}=]*\}=${REQ_NAME}(?!\w)`),
];

/** Source with whitespace collapsed and removed around punctuation, so split calls match. */
function normalise(source: string): string {
  return source
    .replace(/\s+/g, ' ')
    .replace(/ ?(\?\.|[.()[\]{}=,:]) ?/g, '$1');
}

function findReads(source: string): string[] {
  const text = normalise(source);
  const hits: string[] = [];
  for (const pattern of PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(global)) {
      hits.push(text.slice(Math.max(0, match.index! - 30), match.index! + match[0].length + 10));
    }
  }
  return hits;
}

function listFiles(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out;
}

function scannedFiles(): string[] {
  return [
    path.join(ROOT, 'src/middleware.ts'),
    ...listFiles(path.join(ROOT, 'src/app'), (name) => /^route\.(ts|tsx|js)$/.test(name)),
    ...listFiles(path.join(ROOT, 'src/lib'), (name) => /\.(ts|tsx|js)$/.test(name)),
  ];
}

describe('request body reads', () => {
  it('go through readJsonBody in every route handler, the middleware and server libraries', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      for (const hit of findReads(readFileSync(file, 'utf8'))) offenders.push(`${rel}: ...${hit}...`);
    }
    expect(offenders).toEqual([]);
  });

  it('scans the route handlers (sanity check on the file walk)', () => {
    const routes = scannedFiles().filter((file) => /route\.(ts|tsx|js)$/.test(file));
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.filter((file) => readFileSync(file, 'utf8').includes('readJsonBody(')).length).toBeGreaterThan(50);
  });

  it.each([
    'const body = await request.json();',
    'const b = await req.text();',
    'await authReq.formData()',
    'await ctx.request.arrayBuffer()',
    'await request?.json()',
    'await request.json?.()',
    'await (request as NextRequest).json()',
    "await request['json']()",
    'await request["blob"]()',
    'const data = await request\n  .json();',
    'const data = await request\n  ?.text();',
    'new Response(req.body)',
    'const copy = request.clone();',
    'request?.body',
    'const { body } = request;',
    'const {\n  json: read,\n} = req;',
    'const { body, headers } = (request as NextRequest);',
  ])('catches %j', (line) => {
    expect(findReads(line)).not.toEqual([]);
  });

  it.each([
    'const data = await response.json();',
    'const result = await readJsonBody(request);',
    'const { searchParams } = request.nextUrl;',
    'const body = bodyResult.data;',
    'const text = await res.text();',
    'request.headers.get("content-length")',
    'const { body } = await fetch(url);',
  ])('ignores %j', (line) => {
    expect(findReads(line)).toEqual([]);
  });
});
