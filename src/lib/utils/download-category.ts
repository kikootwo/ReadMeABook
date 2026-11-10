/**
 * Component: Download Category Helpers
 * Documentation: documentation/phase3/download-clients.md
 *
 * Client-safe (used by services, routes, the modal and the card). ReadMeABook creates, and
 * sets the save path of, only its own category: `readmeabook` (any case) or the client's
 * `ownedCategory`. A category that already existed in the client is used as is.
 */

import { getClientDisplayName } from '@/lib/interfaces/download-client.interface';

export const DEFAULT_DOWNLOAD_CATEGORY = 'readmeabook';

/** Clients whose category carries a folder ReadMeABook sets (Deluge/Transmission use labels only) */
const PATH_CATEGORY_CLIENTS = new Set(['qbittorrent', 'sabnzbd', 'nzbget']);
const DELUGE_LABEL = /^[a-z0-9_.-]+$/;

export function sameCategory(a?: string | null, b?: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** True for `readmeabook` (any case) and for the category ReadMeABook created in this client */
export function ownsCategory(category?: string | null, ownedCategory?: string | null): boolean {
  const name = category?.trim() || DEFAULT_DOWNLOAD_CATEGORY;
  return sameCategory(name, DEFAULT_DOWNLOAD_CATEGORY) || sameCategory(name, ownedCategory);
}

export function managesCategoryPath(type?: string | null): boolean {
  return !!type && PATH_CATEGORY_CLIENTS.has(type);
}

/** A path client whose category ReadMeABook did not create: never created or re-pathed */
export function isSharedCategory(type: string | undefined, category?: string | null, ownedCategory?: string | null): boolean {
  return managesCategoryPath(type) && !ownsCategory(category, ownedCategory);
}

/** The client's spelling of `name`: an exact match first, then a case-insensitive one */
export function findCategory(list: readonly string[], name: string): string | null {
  if (list.includes(name)) return name;
  return list.find((entry) => sameCategory(entry, name)) ?? null;
}

/** Trimmed, with the client's own casing rules (Deluge and SABnzbd store names lower-case) */
export function normalizeCategory(type: string | undefined, raw?: string | null): string {
  const name = raw?.trim() || DEFAULT_DOWNLOAD_CATEGORY;
  return type === 'deluge' || type === 'sabnzbd' ? name.toLowerCase() : name;
}

/** Field error for a category this client can't use, or null */
export function categoryInputError(type: string | undefined, raw?: string | null): string | null {
  const name = normalizeCategory(type, raw);
  if (name === '*') return 'Choose a category name';
  if (type === 'deluge' && !DELUGE_LABEL.test(name)) {
    return 'Deluge labels can only use letters, numbers, dots, dashes and underscores';
  }
  return null;
}

/** Display only (modal, wizard card): the typed name is in the client's list and isn't ReadMeABook's own */
export function existsInClient(
  type: string | undefined,
  raw: string | null | undefined,
  clientList: readonly string[],
  ownedCategory?: string | null
): boolean {
  if (!type || type === 'transmission') return false;
  const name = normalizeCategory(type, raw);
  return !ownsCategory(name, ownedCategory) && findCategory(clientList, name) !== null;
}

/** The amber note for a category that already exists in the client, or null */
export function existingCategoryNote(type: string | undefined, downloadsTo = "ReadMeABook's download folder"): string | null {
  if (!type) return null;
  const client = getClientDisplayName(type);
  if (type === 'qbittorrent') return `Already in ${client}. ReadMeABook won't change it; files still go to ${downloadsTo}.`;
  if (type === 'sabnzbd' || type === 'nzbget') return `Already in ${client}. ReadMeABook won't change it; downloads use its folder and settings.`;
  if (type === 'deluge') return `Already in ${client}; its label settings apply.`;
  return null;
}

export class CategoryChoiceError extends Error {}

export interface CategoryChoice {
  category: string;
  ownedCategory?: string;
  /** True when the name already existed in the client (ReadMeABook leaves it alone) */
  existing: boolean;
}

/**
 * Decide the stored category and ownership on save. Lists the client only for a new custom
 * name on a path client; a list failure throws (nothing may be saved as owned on a guess).
 */
export async function resolveCategoryChoice(
  input: { type: string; category?: string | null; previous?: { category?: string; ownedCategory?: string } },
  listCategories: () => Promise<string[]>
): Promise<CategoryChoice> {
  const { type, previous } = input;
  const inputError = categoryInputError(type, input.category);
  if (inputError) throw new CategoryChoiceError(inputError);

  const name = normalizeCategory(type, input.category);
  const kept = previous?.ownedCategory;
  if (!managesCategoryPath(type) || sameCategory(name, DEFAULT_DOWNLOAD_CATEGORY)) {
    return { category: sameCategory(name, DEFAULT_DOWNLOAD_CATEGORY) ? DEFAULT_DOWNLOAD_CATEGORY : name, ownedCategory: kept, existing: false };
  }
  if (previous?.category && sameCategory(name, previous.category)) {
    return { category: previous.category, ownedCategory: kept, existing: !ownsCategory(previous.category, kept) };
  }
  if (kept && sameCategory(name, kept)) {
    return { category: kept, ownedCategory: kept, existing: false };
  }

  let names: string[];
  try {
    names = await listCategories();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CategoryChoiceError(`Couldn't read ${getClientDisplayName(type)}'s categories: ${reason}`);
  }
  const found = findCategory(names, name);
  if (found) return { category: normalizeCategory(type, found), ownedCategory: kept, existing: true };
  return { category: name, ownedCategory: name, existing: false };
}
