/**
 * Component: Bulk Import Scanner Utility
 * Documentation: documentation/features/bulk-import.md
 *
 * Recursively discovers audiobook folders, reads embedded metadata via ffprobe,
 * groups loose audio files by metadata, and prepares search terms for Audible
 * matching. Used by the bulk import API.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { AUDIO_EXTENSIONS } from '../constants/audio-formats';
import { isGenericFolderName } from './disc-layout';
import { foldDiscFolders } from './disc-fold';
import { asyncPool } from './async-pool';
import { buildGroupingKey, UNGROUPED_FOLDER_KEY, UNGROUPED_PREFIX } from './bulk-import-keys';

// ffprobe runs via execFile with an argv array (never a shell): paths are untrusted.
const execFilePromise = promisify(execFile);

/** Maximum recursion depth for folder scanning. */
export const MAX_SCAN_DEPTH = 10;

/** Maximum concurrent ffprobe calls for metadata reads. */
const METADATA_CONCURRENCY = 10;

/** Metadata extracted from an audio file via ffprobe. */
export interface AudioFileMetadata {
  title?: string;              // From 'album' tag (book title)
  author?: string;             // From 'album_artist' tag
  narrator?: string;           // From 'composer' tag
  contributingArtists?: string; // From 'artist' tag (contributing artists)
  trackTitle?: string;         // From 'title' tag (chapter/track name)
}

/** A discovered audiobook folder with its metadata and file info. */
export interface DiscoveredAudiobook {
  folderPath: string;
  folderName: string;
  relativePath: string;       // Relative to scan root
  audioFileCount: number;
  totalSizeBytes: number;
  metadata: AudioFileMetadata;
  searchTerm: string;         // Constructed search query for Audible
  metadataSource: 'tags' | 'folder_name' | 'file_name';  // Where the search term came from
  extractedAsin?: string;     // ASIN extracted directly from folder name, if present
  audioFiles: string[];       // File names (relative to folderPath) belonging to this book
  groupingKey: string;        // Normalized key for cross-folder deduplication
}

/** Progress callback for streaming updates to the caller. */
export interface ScanProgress {
  phase: 'discovering' | 'reading_metadata' | 'grouping';
  foldersScanned: number;
  audiobooksFound: number;
  currentFolder?: string;
}

/**
 * Check if a file has a supported audio extension.
 */
function isAudioFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Extract an Audible ASIN from a string (typically a folder name).
 * Audible ASINs start with 'B' and are exactly 10 alphanumeric characters.
 * The ASIN must be bounded by a bracket, parenthesis, whitespace, or string
 * boundary to avoid false positives from random alphanumeric sequences.
 * Returns the ASIN string or null if not found.
 */
export function extractAsinFromString(str: string): string | null {
  const match = str.match(/(?:^|[^A-Z0-9])(B[A-Z0-9]{9})(?:$|[^A-Z0-9])/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Read audio metadata from a file using ffprobe.
 * Extracts album, album_artist, composer, and title tags.
 * Returns empty metadata on any failure (non-blocking).
 */
export async function readAudioMetadata(filePath: string): Promise<AudioFileMetadata> {
  try {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath];
    const { stdout } = await execFilePromise('ffprobe', args, { timeout: 15000 });
    const data = JSON.parse(stdout);

    const tags = data?.format?.tags || {};

    // ffprobe tag names can be case-insensitive; check common variants
    const album = tags.album || tags.ALBUM || tags.Album || undefined;
    const albumArtist = tags.album_artist || tags.ALBUM_ARTIST || tags['Album Artist']
      || tags.albumartist || tags.ALBUMARTIST || undefined;
    const composer = tags.composer || tags.COMPOSER || tags.Composer || undefined;
    const artist = tags.artist || tags.ARTIST || tags.Artist
      || tags['Contributing artists'] || tags['CONTRIBUTING ARTISTS'] || undefined;
    const title = tags.title || tags.TITLE || tags.Title || undefined;

    return {
      title: album || undefined,
      author: albumArtist || undefined,
      narrator: composer || undefined,
      contributingArtists: artist || undefined,
      trackTitle: title || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Deduplicate names across author, narrator, and contributing artists fields.
 * Sometimes Album Artist contains "Author, Narrator" and Composer also has "Narrator",
 * and Contributing Artists may overlap with both.
 * We split on common delimiters and cross-reference to remove duplicates.
 */
export function deduplicateNames(
  rawAuthor?: string,
  rawNarrator?: string,
  rawContributingArtists?: string
): { author?: string; narrator?: string; contributingArtists?: string } {
  const splitNames = (str: string): string[] =>
    str.split(/[,;&]/).map((s) => s.trim()).filter(Boolean);

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  const authorNames = rawAuthor ? splitNames(rawAuthor) : [];
  const narratorNames = rawNarrator ? splitNames(rawNarrator) : [];
  const contributingNames = rawContributingArtists ? splitNames(rawContributingArtists) : [];

  // Build sets for cross-referencing
  const authorNormalized = new Set(authorNames.map(normalize));
  const narratorNormalized = new Set(narratorNames.map(normalize));

  // Remove from author list any name that appears in narrator list
  const dedupedAuthors = authorNames.filter(
    (name) => !narratorNormalized.has(normalize(name))
  );

  // Remove from contributing artists any name already in author or narrator
  const allKnown = new Set([...authorNormalized, ...narratorNormalized]);
  const dedupedContributing = contributingNames.filter(
    (name) => !allKnown.has(normalize(name))
  );

  return {
    author: dedupedAuthors.length > 0 ? dedupedAuthors.join(', ')
      : rawAuthor || undefined,
    narrator: rawNarrator || undefined,
    contributingArtists: dedupedContributing.length > 0
      ? dedupedContributing.join(', ')
      : undefined,
  };
}

/**
 * Clean a raw string (folder name or file name) for use as an Audible search term.
 * Strips file extension, bracketed ASINs, bracketed years, leading track numbers,
 * underscores, and collapses whitespace.
 */
export function cleanSearchString(raw: string): string {
  return raw
    .replace(/\.[^.]+$/, '')                       // Remove file extension
    .replace(/[\[\(][A-Z0-9]{10}[\]\)]/g, '')     // Remove ASIN in brackets
    .replace(/[\[\(]\d{4}[\]\)]/g, '')             // Remove year in brackets
    .replace(/^\d+[\s._-]+/, '')                   // Remove leading track numbers
    .replace(/[_]/g, ' ')                           // Underscores to spaces
    .replace(/\s+/g, ' ')                           // Collapse whitespace
    .trim();
}

/**
 * Build a search term from metadata or folder/file name.
 * Returns the search term and the source it was derived from.
 *
 * Fallback chain (when no album metadata tag is present):
 *   1. Folder name — if provided and not a generic name (CD1, Disc 2, Part 3, etc.)
 *   2. First audio file name — last resort, always available
 *
 * When metadata tags are present, constructs "Title Author Narrator ContributingArtists".
 */
export function buildSearchTerm(
  metadata: AudioFileMetadata,
  firstFileName: string,
  folderName?: string
): { searchTerm: string; source: 'tags' | 'folder_name' | 'file_name' } {
  const { author, narrator, contributingArtists } = deduplicateNames(
    metadata.author,
    metadata.narrator,
    metadata.contributingArtists
  );
  const title = metadata.title;

  // If we have at least a title from metadata, use tags
  if (title) {
    const parts = [title];
    if (author) parts.push(author);
    if (narrator) parts.push(narrator);
    if (contributingArtists) parts.push(contributingArtists);
    return { searchTerm: parts.join(' '), source: 'tags' };
  }

  // Fallback 1: folder name (if provided and not generic)
  if (folderName && !isGenericFolderName(folderName)) {
    const cleaned = cleanSearchString(folderName);
    if (cleaned) {
      return { searchTerm: cleaned, source: 'folder_name' };
    }
  }

  // Fallback 2: first audio file name
  const cleaned = cleanSearchString(firstFileName);
  return { searchTerm: cleaned || firstFileName, source: 'file_name' };
}

/**
 * Scan a single directory for audio files (immediate children only).
 * Returns audio file names and total size, or null if no audio files found.
 */
async function scanDirectoryForAudio(
  dirPath: string
): Promise<{ audioFiles: string[]; totalSize: number } | null> {
  try {
    const children = await fs.readdir(dirPath, { withFileTypes: true });
    const audioFiles: string[] = [];
    let totalSize = 0;

    for (const child of children) {
      if (child.isFile() && isAudioFile(child.name)) {
        audioFiles.push(child.name);
        try {
          const stat = await fs.stat(path.join(dirPath, child.name));
          totalSize += stat.size;
        } catch {
          /* skip unreadable files */
        }
      }
    }

    if (audioFiles.length === 0) return null;

    audioFiles.sort((a, b) => a.localeCompare(b));
    return { audioFiles, totalSize };
  } catch {
    return null;
  }
}

/**
 * Group audio files in a directory by their metadata.
 * Reads metadata from all files using a concurrency pool, then groups them
 * by a normalized key of title + author + narrator.
 *
 * Files with a metadata title are grouped by their shared key. Files with no
 * metadata title are all grouped together under a single '__ungrouped_folder'
 * key (rather than one entry per file), treating the folder as one book.
 * If a folder contains both tagged and untagged files, the untagged files form
 * one extra group alongside the tagged groups.
 */
async function groupAudioFilesByMetadata(
  dirPath: string,
  audioFiles: string[],
  audioSizes: Map<string, number>,
  folderName: string
): Promise<Array<{
  files: string[];
  totalSize: number;
  metadata: AudioFileMetadata;
  metadataSource: 'tags' | 'folder_name' | 'file_name';
  searchTerm: string;
  groupingKey: string;
}>> {
  // Read metadata from all files with concurrency limit
  const metadataResults = await asyncPool(
    audioFiles,
    METADATA_CONCURRENCY,
    async (fileName) => {
      const filePath = path.join(dirPath, fileName);
      const metadata = await readAudioMetadata(filePath);
      return { fileName, metadata };
    }
  );

  // Group by metadata key
  const groups = new Map<string, {
    files: string[];
    totalSize: number;
    metadata: AudioFileMetadata;
  }>();

  for (const { fileName, metadata } of metadataResults) {
    const key = buildGroupingKey(metadata);
    const fileSize = audioSizes.get(fileName) || 0;

    if (key) {
      // Has metadata title — group with others sharing the same key
      const existing = groups.get(key);
      if (existing) {
        existing.files.push(fileName);
        existing.totalSize += fileSize;
      } else {
        groups.set(key, {
          files: [fileName],
          totalSize: fileSize,
          metadata,
        });
      }
    } else {
      // No title metadata — one folder-level group (deduplicateDiscoveries keeps UNGROUPED_PREFIX keys per folder)
      const ungroupedKey = UNGROUPED_FOLDER_KEY;
      const existing = groups.get(ungroupedKey);
      if (existing) {
        existing.files.push(fileName);
        existing.totalSize += fileSize;
      } else {
        groups.set(ungroupedKey, {
          files: [fileName],
          totalSize: fileSize,
          metadata,
        });
      }
    }
  }

  // If there is exactly one tagged group alongside an ungrouped group, absorb
  // the untagged files into the tagged group. Untagged files in the same folder
  // almost certainly belong to the same book (e.g. one chapter was ripped
  // without tags, or a cover/intro file carries different metadata).
  // Only do this when there is a single tagged group — multiple tagged groups
  // mean genuinely different books are mixed in the folder, so keep them separate.
  const ungrouped = groups.get(UNGROUPED_FOLDER_KEY);
  if (ungrouped) {
    const taggedKeys = Array.from(groups.keys()).filter((k) => k !== UNGROUPED_FOLDER_KEY);
    if (taggedKeys.length === 1) {
      const taggedGroup = groups.get(taggedKeys[0])!;
      taggedGroup.files.push(...ungrouped.files);
      taggedGroup.totalSize += ungrouped.totalSize;
      groups.delete(UNGROUPED_FOLDER_KEY);
    }
  }

  // Build result with search terms
  return Array.from(groups.entries()).map(([groupingKey, group]) => {
    group.files.sort((a, b) => a.localeCompare(b));
    const { searchTerm, source } = buildSearchTerm(group.metadata, group.files[0], folderName);
    return {
      files: group.files,
      totalSize: group.totalSize,
      metadata: group.metadata,
      metadataSource: source,
      searchTerm,
      groupingKey,
    };
  });
}

/**
 * Merge discoveries that share the same grouping key across different folders.
 * Handles the multi-CD case (e.g., CD1/ and CD2/ with same metadata).
 */
function deduplicateDiscoveries(
  discoveries: DiscoveredAudiobook[]
): DiscoveredAudiobook[] {
  const byKey = new Map<string, DiscoveredAudiobook[]>();

  for (const disc of discoveries) {
    // Skip ungrouped entries (each is unique)
    if (disc.groupingKey.startsWith(UNGROUPED_PREFIX)) {
      const key = `${disc.folderPath}::${disc.groupingKey}`;
      byKey.set(key, [disc]);
      continue;
    }

    const existing = byKey.get(disc.groupingKey);
    if (existing) {
      existing.push(disc);
    } else {
      byKey.set(disc.groupingKey, [disc]);
    }
  }

  const merged: DiscoveredAudiobook[] = [];

  for (const group of byKey.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    // Merge multiple discoveries with the same key
    // Use the common parent directory as the folder path
    const allPaths = group.map((d) => d.folderPath);
    const commonParent = findCommonParent(allPaths);
    const first = group[0];

    // Combine audio files with relative paths from the common parent
    const combinedFiles: string[] = [];
    let combinedSize = 0;
    let combinedCount = 0;

    for (const disc of group) {
      const relPrefix = path.relative(commonParent, disc.folderPath).replace(/\\/g, '/');
      for (const file of disc.audioFiles) {
        combinedFiles.push(relPrefix ? `${relPrefix}/${file}` : file);
      }
      combinedSize += disc.totalSizeBytes;
      combinedCount += disc.audioFileCount;
    }

    const mergedFolderName = path.basename(commonParent);
    merged.push({
      folderPath: commonParent,
      folderName: mergedFolderName,
      relativePath: first.relativePath.split('/').slice(0, -1).join('/') || mergedFolderName,
      audioFileCount: combinedCount,
      totalSizeBytes: combinedSize,
      metadata: first.metadata,
      searchTerm: first.searchTerm,
      metadataSource: first.metadataSource,
      extractedAsin: extractAsinFromString(mergedFolderName) ?? first.extractedAsin,
      audioFiles: combinedFiles,
      groupingKey: first.groupingKey,
    });
  }

  return merged;
}

/**
 * Find the longest common parent directory among a set of paths.
 */
function findCommonParent(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) return paths[0];

  const normalized = paths.map((p) => p.replace(/\\/g, '/'));
  const parts = normalized.map((p) => p.split('/'));
  const minLen = Math.min(...parts.map((p) => p.length));

  let commonParts = 0;
  for (let i = 0; i < minLen; i++) {
    if (parts.every((p) => p[i] === parts[0][i])) {
      commonParts = i + 1;
    } else {
      break;
    }
  }

  return parts[0].slice(0, commonParts).join('/');
}

/**
 * Recursively discover audiobooks starting from a root path.
 *
 * Scans every folder for audio files. When audio files are found, they are
 * grouped by metadata (title + author + narrator) — each group becomes a
 * separate discovered audiobook. Files with no metadata are all grouped
 * together per folder (treated as one book) rather than one entry per file.
 * Scanning ALWAYS recurses into subfolders regardless of whether the current
 * folder has audio files.
 *
 * After the full walk, disc folders of one book folder (CD1/, CD2/) fold into
 * it, then discoveries sharing a grouping key across folders are merged.
 *
 * @param rootPath - The root directory to scan
 * @param onProgress - Optional callback for progress updates
 * @param abortSignal - Optional AbortSignal to cancel the scan
 * @param protectedRoots - Configured roots that disc folders never fold into
 * @returns Array of discovered audiobook folders with metadata
 */
export async function discoverAudiobooks(
  rootPath: string,
  onProgress?: (progress: ScanProgress) => void,
  abortSignal?: AbortSignal,
  protectedRoots: readonly string[] = []
): Promise<DiscoveredAudiobook[]> {
  const results: DiscoveredAudiobook[] = [];
  let foldersScanned = 0;

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    if (abortSignal?.aborted) return;

    foldersScanned++;

    const folderName = path.basename(currentPath);

    onProgress?.({
      phase: 'discovering',
      foldersScanned,
      audiobooksFound: results.length,
      currentFolder: folderName,
    });

    // Check if this folder contains audio files
    const audioResult = await scanDirectoryForAudio(currentPath);

    if (audioResult) {
      // Build size lookup for grouping
      const audioSizes = new Map<string, number>();
      for (const fileName of audioResult.audioFiles) {
        try {
          const stat = await fs.stat(path.join(currentPath, fileName));
          audioSizes.set(fileName, stat.size);
        } catch {
          audioSizes.set(fileName, 0);
        }
      }

      onProgress?.({
        phase: 'grouping',
        foldersScanned,
        audiobooksFound: results.length,
        currentFolder: folderName,
      });

      // Group audio files by metadata, passing folder name for fallback search terms
      const groups = await groupAudioFilesByMetadata(
        currentPath,
        audioResult.audioFiles,
        audioSizes,
        folderName
      );

      const relativePath = path.relative(rootPath, currentPath).replace(/\\/g, '/');

      // Extract ASIN from folder name once for all groups in this folder
      const extractedAsin = extractAsinFromString(folderName) ?? undefined;

      for (const group of groups) {
        results.push({
          folderPath: currentPath.replace(/\\/g, '/'),
          folderName,
          relativePath: relativePath || folderName,
          audioFileCount: group.files.length,
          totalSizeBytes: group.totalSize,
          metadata: group.metadata,
          searchTerm: group.searchTerm,
          metadataSource: group.metadataSource,
          extractedAsin,
          audioFiles: group.files,
          groupingKey: group.groupingKey,
        });
      }

      onProgress?.({
        phase: 'reading_metadata',
        foldersScanned,
        audiobooksFound: results.length,
        currentFolder: folderName,
      });
    }

    // Always recurse into subfolders
    try {
      const children = await fs.readdir(currentPath, { withFileTypes: true });
      const subdirs = children
        .filter((c) => c.isDirectory() && !c.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const subdir of subdirs) {
        if (abortSignal?.aborted) return;
        await walk(path.join(currentPath, subdir.name), depth + 1);
      }
    } catch {
      /* directory not readable — skip */
    }
  }

  await walk(rootPath, 0);

  // Post-scan: fold disc folders into their book folder, then merge same-key discoveries
  const fold = { rootPath: rootPath.replace(/\\/g, '/'), protectedRoots, buildSearchTerm, extractAsin: extractAsinFromString };
  return deduplicateDiscoveries(await foldDiscFolders(results, fold));
}
