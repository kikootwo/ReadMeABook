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
import { TAG_TEMP_SUFFIX } from './path-component';
import {
  bookDetailValues,
  capUtf8Bytes,
  describeFfmpegFailure,
  MAX_DESCRIPTION_BYTES,
  sanitizeGenreName,
  sanitizeMetadataValue,
  sanitizeMultilineValue,
  truncateRawText,
  type BookDetails,
} from './metadata-text';
import type { DiscTrackTags } from './disc-layout';

const execFilePromise = promisify(execFile);

/** The book's tag values; publisher, subtitle and language come from BookDetails. */
export interface MetadataTaggingOptions extends BookDetails {
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

/** What the MP4 freeform post-step writes. */
export type Mp4FreeformMetadata = Pick<MetadataTaggingOptions, 'asin'> & BookDetails;

/**
 * Joins genres into one tag. Audiobookshelf splits genre tags on '/', '//' or ';'
 * (first match wins), so a '/' inside a genre name becomes ' & '.
 */
const GENRE_SEPARATOR = '; ';

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
 * iTunes freeform ('----', com.apple.iTunes) tags for MP4 containers: ffmpeg's
 * mp4 muxer drops these keys, so they are added after ffmpeg by
 * addMp4FreeformTags. New custom fields are added here. A value that is empty
 * after sanitizing is left out: the post-step writes all tags or none, so one
 * bad value must not cost the others (the ASIN above all).
 */
export function buildMp4FreeformTags(metadata: Mp4FreeformMetadata): FreeformTag[] {
  const tags: FreeformTag[] = [];
  const asin = metadata.asin ? sanitizeMetadataValue(metadata.asin) : '';
  if (asin) tags.push({ name: 'ASIN', value: asin });
  const { publisher, subtitle, language } = bookDetailValues(metadata);
  if (publisher) tags.push({ name: 'PUBLISHER', value: publisher });
  if (subtitle) tags.push({ name: 'SUBTITLE', value: subtitle });
  if (language) tags.push({ name: 'LANGUAGE', value: language });
  return tags;
}

/**
 * Add the MP4 freeform tags (ASIN, PUBLISHER, SUBTITLE, LANGUAGE) to `filePath`,
 * an MP4 RMAB's own ffmpeg run just wrote (the tagged copy or the merged file);
 * `sourceExt` is the format's extension. The organizer's one call, on the file
 * about to be placed. No-op for other formats; never throws (a warning instead,
 * the file unchanged).
 */
export async function addMp4FreeformTags(
  filePath: string,
  sourceExt: string,
  metadata: Mp4FreeformMetadata
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
  metadata: MetadataTaggingOptions,
  position?: DiscTrackTags
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
    const description = metadata.description
      ? capUtf8Bytes(sanitizeMultilineValue(truncateRawText(metadata.description)), MAX_DESCRIPTION_BYTES) || undefined
      : undefined;
    const genre = metadata.genres
      ?.map(sanitizeGenreName)
      .filter((name) => name.length > 0)
      .join(GENRE_SEPARATOR);
    const { publisher, subtitle, language } = bookDetailValues(metadata);

    // Create temporary file path
    const tempFile = `${filePath}${TAG_TEMP_SUFFIX}`;

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

      // ASIN, PUBLISHER, SUBTITLE, LANGUAGE: iTunes freeform tags, added later by addMp4FreeformTags (ffmpeg drops them)

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

      if (description) {
        // ffmpeg's `comment` is the Vorbis DESCRIPTION field; it replaces the source's
        // (a `description` key would be a second DESCRIPTION, read as "old;new")
        args.push('-metadata', `comment=${description}`);
      }

      if (genre) {
        args.push('-metadata', `genre=${genre}`);
      }

      // Vorbis fields match case-insensitively, so these replace the source's PUBLISHER/SUBTITLE/LANGUAGE
      // (ORGANIZATION and LABEL, other publisher fields, are left as they are)
      if (publisher) {
        args.push('-metadata', `publisher=${publisher}`);
      }

      if (subtitle) {
        args.push('-metadata', `subtitle=${subtitle}`);
      }

      if (language) {
        args.push('-metadata', `language=${language}`);
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

      if (publisher) {
        args.push('-metadata', `publisher=${publisher}`); // TPUB frame
      }

      if (subtitle) {
        // TIT3, the ID3 subtitle frame (Mp3tag, Picard and Audiobookshelf's own embedding use it).
        // ffmpeg's `subtitle` key is a TXXX frame, which would sit next to a source TIT3: cleared instead.
        args.push(
          '-metadata', `TIT3=${subtitle}`,
          '-metadata', 'subtitle='
        );
      }

      if (language) {
        // TLAN frame. ID3 expects an ISO 639-2 code here; the language name is what Audiobookshelf shows
        args.push('-metadata', `language=${language}`);
      }

      // Explicitly specify output format (fixes .tmp extension issue)
      args.push('-f', 'mp3');
    }

    // A multi-disc book's disc and track (`d/D`, `n/N`), one argv element each: trkn/disk, TPOS/TRCK, DISCNUMBER/TRACKNUMBER.
    // FLAC keeps totals in their own fields, so they are replaced too. No disc value: the source's disc is cleared.
    const isPosition = (v: string) => /^\d{1,4}\/\d{1,4}$/.test(v);
    const { disc, track } = position ?? {};
    if (track && isPosition(track) && (disc === undefined || isPosition(disc))) {
      const flac = (keys: string[], value: string) => (ext === '.flac' ? keys.flatMap((k) => ['-metadata', `${k}=${value}`]) : []);
      const total = (value?: string) => value?.split('/')[1] ?? '';
      args.push('-metadata', `disc=${disc ?? ''}`, ...flac(disc ? [] : ['DISCNUMBER'], ''), ...flac(['DISCTOTAL', 'TOTALDISCS'], total(disc)));
      args.push('-metadata', `track=${track}`, ...flac(['TRACKTOTAL', 'TOTALTRACKS'], total(track)));
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

      throw new Error(`ffmpeg failed: ${describeFfmpegFailure(error)}`);
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
 * Tag multiple audio files with metadata (`positions`: each file's disc and track, when it has one)
 */
export async function tagMultipleFiles(
  filePaths: string[],
  metadata: MetadataTaggingOptions,
  positions?: Array<DiscTrackTags | undefined>
): Promise<TaggingResult[]> {
  const results: TaggingResult[] = [];

  for (const [i, filePath] of filePaths.entries()) {
    const position = positions?.[i];
    results.push(await (position ? tagAudioFileMetadata(filePath, metadata, position) : tagAudioFileMetadata(filePath, metadata)));
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
