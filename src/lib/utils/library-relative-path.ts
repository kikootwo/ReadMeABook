/**
 * Component: Library Relative Path
 * Documentation: documentation/features/audiosilo-integration.md
 */

import path from 'node:path';

/**
 * A path's location relative to the media library root, with forward slashes.
 * Undefined when the path is the root itself or lies outside it.
 */
export function libraryRelativePath(target: string | null | undefined, mediaDir: string | null | undefined): string | undefined {
  if (!target || !mediaDir) return undefined;
  const relative = path.relative(path.resolve(mediaDir), path.resolve(target));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join('/');
}
