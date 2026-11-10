/**
 * Component: Theme Resolution Tests (dark variant + :root colours from the real globals.css)
 * Documentation: documentation/frontend/components.md
 *
 * Compiles src/app/globals.css with Tailwind, then checks every (choice x device setting) pair:
 * which generated `dark:` rules and which :root colour rules apply. System must resolve exactly
 * like the device; Light and Dark must win over it.
 */

// @vitest-environment jsdom

import { readFileSync } from 'fs';
import path from 'path';
import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import { THEME_ATTRIBUTE, THEME_CHOICES, type ThemeChoice } from '@/lib/constants/theme';

type Device = 'light' | 'dark';
type Block = { prelude: string; decls: string[]; children: Block[] };
type StyleRule = { selector: string; media: string[]; decls: string[] };

const ROOT = path.resolve(__dirname, '../..');
const TAILWIND_DIR = path.join(ROOT, 'node_modules', 'tailwindcss');
const DARK_MEDIA = '(prefers-color-scheme: dark)';

/** Minimal parser for Tailwind's output: nested blocks and declarations. */
function parseCss(css: string): Block[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const parseBody = (): { children: Block[]; decls: string[] } => {
    const children: Block[] = [];
    const decls: string[] = [];
    let buffer = '';
    while (i < src.length) {
      const ch = src[i++];
      if (ch === '{') {
        const prelude = buffer.trim();
        buffer = '';
        children.push({ prelude, ...parseBody() });
      } else if (ch === '}' || ch === ';') {
        if (buffer.trim()) decls.push(buffer.trim());
        buffer = '';
        if (ch === '}') break;
      } else {
        buffer += ch;
      }
    }
    return { children, decls };
  };
  return parseBody().children;
}

function styleRules(blocks: Block[], media: string[] = []): StyleRule[] {
  return blocks.flatMap((block) => {
    if (block.prelude.startsWith('@media')) return styleRules(block.children, [...media, block.prelude.slice(6).trim()]);
    if (block.prelude.startsWith('@')) return styleRules(block.children, media);
    return [{ selector: block.prelude, media, decls: block.decls }, ...styleRules(block.children, media)];
  });
}

async function compileGlobals(candidates: string[]): Promise<StyleRule[]> {
  const css = readFileSync(path.join(ROOT, 'src', 'app', 'globals.css'), 'utf8');
  const compiler = await compile(css, {
    base: path.join(ROOT, 'src', 'app'),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? path.join(TAILWIND_DIR, 'index.css') : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  return styleRules(parseCss(compiler.build(candidates)));
}

function mediaApplies(query: string, device: Device): boolean {
  if (query === DARK_MEDIA) return device === 'dark';
  throw new Error(`unexpected media query in a theme rule: ${query}`);
}

function setChoice(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(THEME_ATTRIBUTE, choice);
}

const CASES: { choice: ThemeChoice; device: Device; dark: boolean }[] = [
  { choice: 'system', device: 'light', dark: false },
  { choice: 'system', device: 'dark', dark: true },
  { choice: 'light', device: 'light', dark: false },
  { choice: 'light', device: 'dark', dark: false },
  { choice: 'dark', device: 'light', dark: true },
  { choice: 'dark', device: 'dark', dark: true },
];

describe('theme resolution in globals.css', () => {
  let darkRules: StyleRule[];
  let rootRules: StyleRule[];

  beforeAll(async () => {
    const rules = await compileGlobals(['dark:bg-gray-900']);
    darkRules = rules.filter((r) => r.selector.includes('.dark\\:bg-gray-900'));
    rootRules = rules.filter((r) => r.selector.startsWith(':root') && r.decls.some((d) => d.startsWith('color-scheme')));
  });

  it('the matrix covers every choice and both device settings', () => {
    expect(new Set(CASES.map((c) => c.choice))).toEqual(new Set(THEME_CHOICES));
    expect(darkRules.length).toBeGreaterThan(0);
    expect(rootRules.length).toBeGreaterThan(0);
  });

  it.each(CASES)('dark: utilities, choice $choice on a $device device -> dark=$dark', ({ choice, device, dark }) => {
    document.body.innerHTML = '<main><p class="dark:bg-gray-900">x</p></main>';
    const el = document.querySelector('p') as HTMLElement;
    setChoice(choice);
    const applies = darkRules.some((r) => r.media.every((m) => mediaApplies(m, device)) && el.matches(r.selector));
    expect(applies).toBe(dark);
  });

  it.each(CASES)(':root colours, choice $choice on a $device device -> dark=$dark', ({ choice, device, dark }) => {
    setChoice(choice);
    // Every :root colour rule has the same specificity (0,1,0), so the last matching one wins.
    for (const r of rootRules) expect(r.selector).toMatch(/^:root(:where\(.+\))?$/);
    const winner = rootRules
      .filter((r) => r.media.every((m) => mediaApplies(m, device)) && document.documentElement.matches(r.selector))
      .at(-1);
    expect(winner?.decls).toContain(`color-scheme: ${dark ? 'dark' : 'light'}`);
    expect(winner?.decls).toContain(`--background: ${dark ? '#0a0a0a' : '#ffffff'}`);
  });
});
