/**
 * Component: Metadata Tagging Utility
 * Documentation: documentation/phase3/file-organization.md
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { METADATA_TAG_FORMATS, MP4_CONTAINER_FORMATS } from '../constants/audio-formats';
import { addFreeformTags, type FreeformTag, type FreeformTagResult } from './mp4-freeform-tags';

const execFilePromise = promisify(execFile);

export interface MetadataTaggingOptions {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  asin?: string;
  series?: string;
  seriesPart?: string;
}

export interface TaggingResult {
  success: boolean;
  filePath: string; // Original file path
  taggedFilePath?: string; // Path to tagged file (if successful)
  error?: string;
}

const isMp4Container = (ext: string) => (MP4_CONTAINER_FORMATS as readonly string[]).includes(ext.toLowerCase());

/**
 * ffmpeg timeout for a codec-copy re-mux of `sizeBytes`: 120 s plus 120 s per
 * GiB. With +faststart the file is written twice (copy, then moov moved to the
 * front), about 4 bytes of I/O per byte, so this allows ~35 MB/s of storage I/O.
 */
export function ffmpegRemuxTimeoutMs(sizeBytes: number): number {
  return 120_000 + Math.ceil((sizeBytes / 1024 ** 3) * 120_000);
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
 * iTunes freeform ('----', com.apple.iTunes) tags for MP4 containers: ffmpeg's
 * mp4 muxer drops these keys, so they are added after ffmpeg by
 * addMp4FreeformTags. New custom fields (e.g. PUBLISHER) are added here.
 */
export function buildMp4FreeformTags(metadata: Pick<MetadataTaggingOptions, 'asin'>): FreeformTag[] {
  const tags: FreeformTag[] = [];
  const asin = metadata.asin ? sanitizeMetadataValue(metadata.asin) : '';
  if (asin) tags.push({ name: 'ASIN', value: asin });
  return tags;
}

/**
 * Add the MP4 freeform tags (ASIN) to `filePath`, an MP4 RMAB's own ffmpeg run
 * just wrote (the tagged copy or the merged file); `sourceExt` is the format's
 * extension. The organizer's one call, on the file about to be placed. No-op
 * for other formats; never throws (a warning instead, the file unchanged).
 */
export async function addMp4FreeformTags(
  filePath: string,
  sourceExt: string,
  metadata: Pick<MetadataTaggingOptions, 'asin'>
): Promise<FreeformTagResult> {
  return isMp4Container(sourceExt) ? addFreeformTags(filePath, buildMp4FreeformTags(metadata)) : { written: false };
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
    // Check if file exists (its size scales the ffmpeg timeout)
    const { size } = await fs.stat(filePath);

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
    if (isMp4Container(ext)) {
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

      // ASIN: an iTunes freeform tag, added later by addMp4FreeformTags (ffmpeg drops it)

      if (series) {
        args.push('-metadata', `show=${series}`);
      }

      if (seriesPart) {
        args.push('-metadata', `episode_id=${seriesPart}`);
      }

      // moov first (faststart), also when the freeform post-step later refuses the file
      args.push('-movflags', '+faststart');

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

      // Explicitly specify output format (fixes .tmp extension issue)
      args.push('-f', 'mp3');
    }

    // Output to temp file
    args.push(tempFile);

    try {
      await execFilePromise('ffmpeg', args, { timeout: ffmpegRemuxTimeoutMs(size) });
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
