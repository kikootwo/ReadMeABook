/**
 * Component: NZBGet Category Folder
 * Documentation: documentation/phase3/file-organization.md
 *
 * The folder an NZBGet category writes jobs to, as NZBGet sees it, from its `config` list:
 * `CategoryN.DestDir`, else the main `DestDir` (plus the category name unless AppendCategoryDir
 * is off). Null when the category isn't listed or the folder can't be told (a `${...}` variable,
 * or a path that is not absolute).
 */

import { sameCategory } from '@/lib/utils/download-category';
import { isAbsoluteClientPath } from '@/lib/utils/client-path';

export function nzbgetCategoryFolder(config: ReadonlyArray<{ Name: string; Value: string }>, name: string): string | null {
  const value = (key: string) => config.find((entry) => entry.Name.toLowerCase() === key.toLowerCase())?.Value?.trim() ?? '';
  const entry = config.find((item) => /^Category\d+\.Name$/i.test(item.Name) && sameCategory(item.Value, name));
  const slot = entry?.Name.match(/\d+/)?.[0];
  if (!entry || !slot) return null;

  let folder = value(`Category${slot}.DestDir`);
  if (!folder) {
    const main = value('DestDir');
    if (!main) return null;
    folder = value('AppendCategoryDir').toLowerCase() === 'no' ? main : `${main.replace(/[/\\]+$/, '')}/${entry.Value.trim()}`;
  }
  return folder.includes('${') || !isAbsoluteClientPath(folder) ? null : folder;
}
