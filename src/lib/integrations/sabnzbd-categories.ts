/**
 * Component: SABnzbd Category List Parsing
 * Documentation: documentation/phase3/sabnzbd.md
 *
 * SABnzbd 4.x answers get_config `categories` as an array of `{name, dir, ...}` with `*` (its
 * default category) first; an object keyed by name is kept as a fallback. Fails closed: a
 * misread list would make every category look missing, and set_config creates OR updates.
 */

export interface SabCategory {
  name: string;
  dir: string;
}

export function parseSabCategories(raw: unknown): SabCategory[] {
  if (Array.isArray(raw)) {
    const categories = raw.map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof (entry as { name?: unknown }).name !== 'string') {
        throw new Error('Unrecognised SABnzbd category list');
      }
      const { name, dir } = entry as { name: string; dir?: unknown };
      return { name, dir: typeof dir === 'string' ? dir : '' };
    });
    if (!categories.some((c) => c.name === '*')) {
      throw new Error('SABnzbd category list has no "*" entry; not read');
    }
    return categories;
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, { dir?: unknown } | null>).map(([name, details]) => ({
      name,
      dir: typeof details?.dir === 'string' ? details.dir : '',
    }));
  }
  throw new Error('Unrecognised SABnzbd category list');
}
