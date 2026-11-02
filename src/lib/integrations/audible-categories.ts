/**
 * Component: Audible Category Tree Parser
 * Documentation: documentation/features/home-sections.md
 *
 * Maps the catalog API's `/1.0/catalog/categories?categories_num_levels=2`
 * envelope to top-level categories, each with its sub-categories.
 */

/** Levels requested from the catalog API: top-level categories and their direct sub-categories. */
export const CATALOG_CATEGORY_LEVELS = 2;

export interface AudibleSubcategory {
  id: string;
  name: string;
  parentId: string;
}

export interface AudibleCategoryNode {
  id: string;
  name: string;
  subcategories: AudibleSubcategory[];
}

interface RawCategory {
  id?: unknown;
  name?: unknown;
  children?: unknown;
}

function readNode(raw: unknown): { id: string; name: string; children: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, name, children } = raw as RawCategory;
  const cleanId = typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '';
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanId || !cleanName) return null;
  return { id: cleanId, name: cleanName, children };
}

/**
 * Top-level categories in catalog order, each with its sub-categories in catalog order.
 * Entries without an id or name are skipped, as are a sub-category repeated within one
 * parent and a sub-category with its parent's own id. The same sub-category id can sit
 * under two parents (Audible lists e.g. True Crime under two); it is kept under both.
 * A response without `children` (one level) gives every category an empty list.
 */
export function parseCatalogCategories(envelope: unknown): AudibleCategoryNode[] {
  const list = (envelope as { categories?: unknown } | null | undefined)?.categories;
  if (!Array.isArray(list)) return [];

  const seenTop = new Set<string>();
  const result: AudibleCategoryNode[] = [];

  for (const raw of list) {
    const top = readNode(raw);
    if (!top || seenTop.has(top.id)) continue;
    seenTop.add(top.id);

    const seenChild = new Set<string>([top.id]);
    const subcategories: AudibleSubcategory[] = [];
    for (const rawChild of Array.isArray(top.children) ? top.children : []) {
      const child = readNode(rawChild);
      if (!child || seenChild.has(child.id)) continue;
      seenChild.add(child.id);
      subcategories.push({ id: child.id, name: child.name, parentId: top.id });
    }

    result.push({ id: top.id, name: top.name, subcategories });
  }

  return result;
}
