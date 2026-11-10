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
  let categories: SabCategory[];
  if (Array.isArray(raw)) {
    categories = raw.map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof (entry as { name?: unknown }).name !== 'string') {
        throw new Error('Unrecognised SABnzbd category list');
      }
      const { name, dir } = entry as { name: string; dir?: unknown };
      return { name, dir: typeof dir === 'string' ? dir : '' };
    });
  } else if (raw && typeof raw === 'object') {
    categories = Object.entries(raw as Record<string, { dir?: unknown } | null>).map(([name, details]) => ({
      name,
      dir: typeof details?.dir === 'string' ? details.dir : '',
    }));
  } else {
    throw new Error('Unrecognised SABnzbd category list');
  }
  if (!categories.some((c) => c.name === '*')) {
    throw new Error('SABnzbd category list has no "*" entry; not read');
  }
  return categories;
}

/**
 * The folder a SABnzbd category writes jobs to, as SABnzbd sees it: its `dir` (absolute, or
 * relative to complete_dir; a trailing `*` only turns off job folders), else complete_dir.
 * Null when the category isn't listed or the folder is unknown.
 */
export function sabCategoryFolder(completeDir: string, categories: SabCategory[], name: string): string | null {
  const entry = categories.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (!entry) return null;
  const dir = entry.dir.trim().replace(/\*$/, '');
  if (/^([a-zA-Z]:)?[/\\]/.test(dir)) return dir;
  if (!completeDir) return null;
  return dir ? `${completeDir.replace(/[/\\]+$/, '')}/${dir}` : completeDir;
}
