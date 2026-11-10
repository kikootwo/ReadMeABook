/**
 * Component: Processing progress contract (#216)
 * Documentation: documentation/backend/database.md
 *
 * `request.progress` while `processing` is 100 except during the chapter merge
 * (requestPhase in request-statuses.ts). Every write that sets status
 * 'processing' must also set progress 100, or the request reads
 * "Merging chapters N%" with a leftover value. Checked statically on src/.
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

function property(literal: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return literal.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name
  );
}

/** Object literals that set `status: 'processing'`, outside a `where` filter (a filter reads, it does not write). */
function processingWrites(): { site: string; progress: string | null }[] {
  const sites: { site: string; progress: string | null }[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/status\s*:\s*['"`]processing['"`]/.test(text)) continue; // parse only the candidates
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const status = property(node, 'status');
        const value = status && unwrap(status.initializer);
        const isWhere = ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === 'where';
        if (value && ts.isStringLiteralLike(value) && value.text === 'processing' && !isWhere) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          const progress = property(node, 'progress');
          sites.push({
            site: `${path.relative(SRC, file).replace(/\\/g, '/')}:${line + 1}`,
            progress: progress ? unwrap(progress.initializer).getText() : null,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

describe('processing progress contract', () => {
  it('every write that sets status processing also sets progress: 100', () => {
    const sites = processingWrites();
    // 9 writers today: direct download, bulk import x3, manual import x2, the retry route, organize x2
    expect(sites.length).toBeGreaterThanOrEqual(9);
    expect(sites.filter((s) => s.progress !== '100')).toEqual([]);
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
