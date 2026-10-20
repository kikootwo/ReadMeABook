/**
 * Component: Metadata Tagging Utility
 * Documentation: documentation/phase3/file-organization.md
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { METADATA_TAG_FORMATS, MP4_CONTAINER_FORMATS } from '../constants/audio-formats';

const execFilePromise = promisify(execFile);

export interface MetadataTaggingOptions {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  asin?: string;
  series?: string;
  seriesPart?: string;
  description?: string; // Publisher summary (plain text, may contain paragraphs)
  genres?: string[]; // Top-level genres, joined into one tag
}

/**
 * Joins genres into one tag. Audiobookshelf splits genre tags on '/', '//' or ';'
 * (first match wins); Audible genre names contain '&' and ',' but never ';'.
 */
const GENRE_SEPARATOR = '; ';

export interface TaggingResult {
  success: boolean;
  filePath: string; // Original file path
  taggedFilePath?: string; // Path to tagged file (if successful)
  error?: string;
}

/**
 * Sanitize a metadata value before writing.
 * Conservative — only removes characters that are clearly not intent:
 * - Leading BOM, NBSP, zero-width space, zero-width non-joiner, zero-width joiner
 * - Null bytes, CR, LF anywhere (ffmpeg metadata semantics break on these)
 * - Leading/trailing whitespace
 * Does NOT normalize Unicode forms or otherwise transform content.
 */
function sanitizeMetadataValue(value: string): string {
  return value
    .replace(/^[﻿ ​‌‍]+/, '') // leading BOM / NBSP / ZWSP / ZWNJ / ZWJ
    .replace(/[\x00\r\n]/g, '') // null bytes and line breaks anywhere
    .trim();
}

/**
 * Sanitize a multi-paragraph value: line breaks become single spaces first, so
 * paragraphs never run together when sanitizeMetadataValue drops the breaks.
 */
function sanitizeMultilineValue(value: string): string {
  return sanitizeMetadataValue(value.replace(/[ \t]*[\r\n]+[ \t]*/g, ' '));
}

/**
 * Tag audio file metadata using ffmpeg
 * Supports m4b/m4a/mp4, mp3, and flac files
 * Uses -codec copy for lossless operation (metadata only, no re-encoding)
 *
 * Spawns ffmpeg via execFile with an argv list — no shell interpolation,
 * no quoting required, no shell-injection surface.
 */
export async function tagAudioFileMetadata(
  filePath: string,
  metadata: MetadataTaggingOptions
): Promise<TaggingResult> {
  try {
    // Check if file exists
    await fs.access(filePath);

    const ext = path.extname(filePath).toLowerCase();

    // Only process supported formats
    if (!(METADATA_TAG_FORMATS as readonly string[]).includes(ext)) {
      return {
        success: false,
        filePath,
        error: `Unsupported file format: ${ext}`,
      };
    }

    // Sanitize all string-valued metadata fields at entry
    const title = sanitizeMetadataValue(metadata.title);
    const author = sanitizeMetadataValue(metadata.author);
    const narrator = metadata.narrator ? sanitizeMetadataValue(metadata.narrator) : undefined;
    const asin = metadata.asin ? sanitizeMetadataValue(metadata.asin) : undefined;
    const series = metadata.series ? sanitizeMetadataValue(metadata.series) : undefined;
    const seriesPart = metadata.seriesPart ? sanitizeMetadataValue(metadata.seriesPart) : undefined;
    const description = metadata.description ? sanitizeMultilineValue(metadata.description) : undefined;
    const genre = metadata.genres
      ?.map(sanitizeMetadataValue)
      .filter((name) => name.length > 0)
      .join(GENRE_SEPARATOR);

    // Create temporary file path
    const tempFile = `${filePath}.tmp`;

    // Build ffmpeg argv. Each element is passed as-is to the OS exec syscall;
    // no shell tokenization, no embedded quoting.
    const args: string[] = [
      '-y', // Automatically overwrite files without prompting
      '-i', filePath,
      '-codec', 'copy', // No re-encoding, metadata only
    ];

    // For m4b/m4a/mp4 files, use standard metadata tags
    if ((MP4_CONTAINER_FORMATS as readonly string[]).includes(ext)) {
      args.push(
        '-metadata', `title=${title}`,
        '-metadata', `album=${title}`, // Book title in Album field (Plex uses this)
        '-metadata', `album_artist=${author}`, // Author in Album Artist (PRIMARY for Plex)
        '-metadata', `artist=${author}` // Fallback
      );

      if (narrator) {
        args.push('-metadata', `composer=${narrator}`); // Narrator in Composer
      }

      if (metadata.year !== undefined) {
        args.push('-metadata', `date=${String(metadata.year)}`);
      }

      if (asin) {
        // Use custom iTunes tag format for M4B/M4A/MP4 files
        args.push('-metadata', `----:com.apple.iTunes:ASIN=${asin}`);
      }

      if (series) {
        args.push('-metadata', `show=${series}`);
      }

      if (seriesPart) {
        args.push('-metadata', `episode_id=${seriesPart}`);
      }

      if (description) {
        args.push(
          '-metadata', `description=${description}`, // desc atom (read by Audiobookshelf)
          '-metadata', `synopsis=${description}` // ldes atom (long description)
        );
      }

      if (genre) {
        args.push('-metadata', `genre=${genre}`);
      }

      // Mark the file as an audiobook (stik=2) with gapless playback (pgap=1)
      args.push(
        '-metadata', 'media_type=2',
        '-metadata', 'gapless_playback=1'
      );

      // Explicitly specify output format (fixes .tmp extension issue)
      args.push('-f', 'mp4');
    }
    // For FLAC files, use Vorbis comment tags (native FLAC metadata)
    else if (ext === '.flac') {
      args.push(
        '-metadata', `title=${title}`,
        '-metadata', `album=${title}`,
        '-metadata', `albumartist=${author}`,
        '-metadata', `artist=${author}`
      );

      if (narrator) {
        args.push('-metadata', `composer=${narrator}`);
      }

      if (metadata.year !== undefined) {
        args.push('-metadata', `date=${String(metadata.year)}`);
      }

      if (asin) {
        // FLAC supports arbitrary Vorbis comment tags
        args.push('-metadata', `ASIN=${asin}`);
      }

      if (series) {
        args.push('-metadata', `SERIES=${series}`);
      }

      if (seriesPart) {
        args.push('-metadata', `SERIES-PART=${seriesPart}`);
      }

      if (description) {
        args.push('-metadata', `description=${description}`);
      }

      if (genre) {
        args.push('-metadata', `genre=${genre}`);
      }

      // Explicitly specify output format
      args.push('-f', 'flac');
    }
    // For mp3 files, use ID3v2 tags
    else if (ext === '.mp3') {
      args.push(
        '-metadata', `title=${title}`,
        '-metadata', `album=${title}`,
        '-metadata', `album_artist=${author}`,
        '-metadata', `artist=${author}`
      );

      if (narrator) {
        // For MP3, composer is also used for narrator
        args.push('-metadata', `composer=${narrator}`);
      }

      if (metadata.year !== undefined) {
        args.push('-metadata', `date=${String(metadata.year)}`);
      }

      if (asin) {
        // Use TXXX frame for custom ID3v2 tags in MP3 files
        args.push('-metadata', `ASIN=${asin}`);
      }

      if (series) {
        args.push('-metadata', `SERIES=${series}`);
      }

      if (seriesPart) {
        args.push('-metadata', `SERIES-PART=${seriesPart}`);
      }

      if (description) {
        // TXXX frame, read back as `description` (Audiobookshelf reads this)
        args.push('-metadata', `description=${description}`);
      }

      if (genre) {
        args.push('-metadata', `genre=${genre}`); // TCON frame
      }

      // Explicitly specify output format (fixes .tmp extension issue)
      args.push('-f', 'mp3');
    }

    // Output to temp file
    args.push(tempFile);

    try {
      await execFilePromise('ffmpeg', args, { timeout: 120000 }); // 2 minute timeout
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`ffmpeg failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // DO NOT replace original file - return temp file path instead
    // This preserves the original file for seeding
    return {
      success: true,
      filePath,
      taggedFilePath: tempFile,
    };
  } catch (error) {
    return {
      success: false,
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tag multiple audio files with metadata
 */
export async function tagMultipleFiles(
  filePaths: string[],
  metadata: MetadataTaggingOptions
): Promise<TaggingResult[]> {
  const results: TaggingResult[] = [];

  for (const filePath of filePaths) {
    const result = await tagAudioFileMetadata(filePath, metadata);
    results.push(result);
  }

  return results;
}

/**
 * Check if ffmpeg is available
 */
export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execFilePromise('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}
