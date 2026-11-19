/**
 * Component: Credit Lists (authors, narrators)
 * Documentation: documentation/frontend/components.md
 *
 * Audible author and narrator fields are comma-separated names, some with a role after " - "
 * ("Terry Pratchett, Ben Aaronovitch - introduction"). These helpers split them for display.
 */

export interface Credit {
  name: string;
  role?: string;
}

/** A part that belongs to the name before it ("Martin Luther King, Jr.") */
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|phd|md)\.?$/i;
const ROLE = /^(.*?)\s+-\s+(.+)$/;

export function parseCredits(value?: string | null): Credit[] {
  const parts = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const names: string[] = [];
  for (const part of parts) {
    const bare = part.replace(ROLE, '$1');
    if (names.length > 0 && NAME_SUFFIX.test(bare)) names[names.length - 1] += `, ${part}`;
    else names.push(part);
  }
  return names.map((entry) => {
    const match = entry.match(ROLE);
    return match ? { name: match[1].trim(), role: match[2].trim() } : { name: entry };
  });
}

/** "A", "A and B", or "A, B and 3 more" */
export function summarizeNames(names: string[], shown = 2): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2 && shown >= 2) return `${names[0]} and ${names[1]}`;
  if (names.length <= shown) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}

/**
 * The names for a card line (credits without a role; all of them when every one has a role)
 * and the full list for its hover text, roles in brackets.
 */
export function creditLine(value?: string | null): { summary: string; full: string } {
  const credits = parseCredits(value);
  const main = credits.filter((credit) => !credit.role);
  const names = (main.length > 0 ? main : credits).map((credit) => credit.name);
  return {
    summary: summarizeNames(names),
    full: credits.map((credit) => (credit.role ? `${credit.name} (${credit.role})` : credit.name)).join(', '),
  };
}
