/**
 * Component: Media Directory Resolver
 * Documentation: documentation/phase3/file-organization.md
 */

import { prisma } from '../db';

/** Fallback used when neither the `media_dir` setting nor MEDIA_DIR is set. */
export const DEFAULT_MEDIA_DIR = '/media/audiobooks';

/**
 * Resolve the configured media library root: `media_dir` setting, then the
 * MEDIA_DIR env var, then the default. Single source for the organizer and
 * post-organize cleanup so both agree on where the library lives.
 */
export async function getMediaDir(): Promise<string> {
  const config = await prisma.configuration.findUnique({
    where: { key: 'media_dir' },
  });
  return config?.value || process.env.MEDIA_DIR || DEFAULT_MEDIA_DIR;
}
