/**
 * Component: Processing progress contract (#216)
 * Documentation: documentation/backend/database.md
 *
 * `request.progress` while `processing` is 100 except during the chapter merge
 * (requestPhase in request-statuses.ts). Every write that sets status
 * 'processing' must also set progress 100, or the request reads
 * "Merging chapters N%" with a leftover value. Checked statically on src/.
 *
 * What it finds: an object literal whose `status` property (quoted key too) has a
 * 'processing' string literal anywhere in its value (`ok ? 'processing' : ...`
 * included), outside any `where` (a property or variable of that name, or a filter
 * constant named `..._WHERE` or `...Where`: a read).
 * What it does not find: a status from a variable or shorthand (`{ status }`), an
 * assignment (`data.status = ...`), a spread that overrides `progress`, raw SQL,
 * and writes of `progress` alone (the download processors filter those to
 * `downloading`, tests/processors/*.late-progress.test.ts).
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { requestPhase, requestPhaseText } from '@/lib/constants/request-statuses';

const SRC = path.resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function nameOf(name: ts.PropertyName | ts.BindingName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
}

function property(literal: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return literal.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && nameOf(p.name) === name
  );
}

/** A 'processing' string literal anywhere in the expression. */
function mentionsProcessing(node: ts.Node): boolean {
  return (ts.isStringLiteralLike(node) && node.text === 'processing') || !!ts.forEachChild(node, (child) => mentionsProcessing(child) || undefined);
}

/** `where`, or a filter constant such as `BEING_IMPORTED_WHERE` or `activeWhere`. */
const isWhereName = (name: string | null) => name === 'where' || (!!name && /(_WHERE|Where)$/.test(name));

/** Inside a `where` property or a filter variable (a filter reads, it does not write). */
function inWhere(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isPropertyAssignment(current) || ts.isVariableDeclaration(current)) && isWhereName(nameOf(current.name))) return true;
  }
  return false;
}

type Site = { site: string; progress: string | null };

/** Object literals in one file that can set status 'processing' (see the header). */
function processingWritesIn(file: string, text: string): Site[] {
  const sites: Site[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const status = property(node, 'status');
      if (status && mentionsProcessing(status.initializer) && !inWhere(node)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        const progress = property(node, 'progress');
        sites.push({
          site: `${file}:${line + 1}`,
          progress: progress ? unwrap(progress.initializer).getText() : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function processingWrites(): Site[] {
  return sourceFiles(SRC).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    if (!/['"`]processing['"`]/.test(text)) return []; // parse only the candidates
    return processingWritesIn(path.relative(SRC, file).replace(/\\/g, '/'), text);
  });
}

describe('processing progress contract', () => {
  it('every write that sets status processing also sets progress: 100', () => {
    const sites = processingWrites();
    // 9 writers today: direct download, bulk import x3, manual import x2, the retry route, organize x2
    expect(sites.length).toBeGreaterThanOrEqual(9);
    expect(sites.filter((s) => s.progress !== '100')).toEqual([]);
  });

  const progressOf = (code: string) => processingWritesIn('sample.ts', code).map((s) => s.progress);

  it.each([
    ['a nested where filter', "prisma.request.count({ where: { OR: [{ status: 'processing' }] } })"],
    ['a relation filter', "prisma.user.findMany({ where: { requests: { some: { status: 'processing' } } } })"],
    ['a filter kept in a variable', "const where = { status: 'processing' };"],
    ['a filter constant', "export const BEING_IMPORTED_WHERE = { status: 'processing', deletedAt: null } as const;"],
  ])('skips a read: %s', (_shape, code) => {
    expect(progressOf(code)).toEqual([]);
  });

  it.each([
    ['a plain write', "prisma.request.update({ where: { id }, data: { status: 'processing' } })", [null]],
    ['a ternary status', "prisma.request.update({ where: { id }, data: { status: ok ? 'processing' : 'failed', progress: 0 } })", ['0']],
    ['a quoted key', "prisma.request.update({ where: { id }, data: { 'status': 'processing' } })", [null]],
    ['a write that keeps the contract', "prisma.request.update({ where: { id }, data: { status: 'processing' as const, progress: 100 } })", ['100']],
  ])('finds a write: %s', (_shape, code, expected) => {
    expect(progressOf(code)).toEqual(expected);
  });
});

describe('requestPhase', () => {
  it.each([
    ['processing', 100, { label: 'Organizing files', percent: null }],
    ['processing', 0, { label: 'Merging chapters', percent: 0 }],
    ['processing', 42, { label: 'Merging chapters', percent: 42 }],
    ['processing', 99.6, { label: 'Merging chapters', percent: 99 }],
    ['processing', null, { label: 'Organizing files', percent: null }],
    ['processing', undefined, { label: 'Organizing files', percent: null }],
    ['processing', -1, { label: 'Organizing files', percent: null }],
    ['downloading', 42, null],
    ['downloaded', 100, null],
    ['awaiting_import', 42, null],
    ['failed', 42, null],
  ] as const)('%s at %s', (status, progress, expected) => {
    expect(requestPhase(status, progress)).toEqual(expected);
  });

  it('one-line text for the admin row', () => {
    expect(requestPhaseText({ label: 'Merging chapters', percent: 42 })).toBe('Merging chapters · 42%');
    expect(requestPhaseText({ label: 'Organizing files', percent: null })).toBe('Organizing files');
  });
});
