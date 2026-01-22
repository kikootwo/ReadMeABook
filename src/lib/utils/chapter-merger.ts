/**
 * Component: Chapter Merger Utility
 * Documentation: documentation/features/chapter-merging.md
 *
 * Merges multi-file audiobook chapter downloads into a single M4B file
 * with proper chapter markers.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { JobLogger } from './job-logger';

const execPromise = promisify(exec);

// Supported audio formats for chapter merging
const SUPPORTED_FORMATS = ['.mp3', '.m4a', '.m4b', '.mp4', '.aac'];

// Patterns that indicate chapter-based files
const CHAPTER_PATTERNS = [
  /^(\d{1,3})[\s._-]/,        // "01 - Title.mp3", "1.mp3", "001_chapter.mp3"
  /chapter\s*(\d+)/i,         // "Chapter 1.mp3", "chapter01.mp3"
  /ch\s*(\d+)/i,              // "Ch1.mp3", "ch 01.mp3"
  /part\s*(\d+)/i,            // "Part 1.mp3"
  /disc\s*(\d+)/i,            // "Disc 1.mp3"
  /track\s*(\d+)/i,           // "Track 1.mp3"
];

// Generic title patterns to ignore when extracting chapter names
const GENERIC_TITLE_PATTERNS = [
  /^track\s*\d+$/i,
  /^chapter\s*\d+$/i,
  /^\d+$/,
  /^part\s*\d+$/i,
];

export interface ChapterFile {
  path: string;
  filename: string;
  duration: number;           // milliseconds
  bitrate?: number;           // kbps
  trackNumber?: number;       // from metadata
  titleMetadata?: string;     // from metadata
  titleIsBookTitle?: boolean; // true if titleMetadata is the book title (not chapter-specific)
  chapterTitle: string;       // final computed title
}

export interface AudioProbeResult {
  duration: number;           // milliseconds
  bitrate?: number;           // kbps
  trackNumber?: number;
  title?: string;
  format: string;
}

export interface MergeOptions {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  asin?: string;
  outputPath: string;
}

export interface MergeResult {
  success: boolean;
  outputPath?: string;
  chapterCount?: number;
  totalDuration?: number;     // milliseconds
  error?: string;
}

/**
 * Detect if the given files appear to be chapter files that should be merged
 *
 * New approach: Use simple heuristic (>3 files of same format) and rely on
 * analyzeChapterFiles() to determine if ordering is possible via metadata or filenames.
 * This is more permissive and catches edge cases where filenames don't match patterns
 * but metadata (track numbers) provides correct ordering.
 */
export async function detectChapterFiles(files: string[], logger?: JobLogger): Promise<boolean> {
  // Need at least 3 files to consider as multi-chapter audiobook
  // (2 files might be "Book" + "Credits", so require 3+)
  if (files.length < 3) {
    await logger?.info(`Chapter detection: Only ${files.length} file(s) - not enough for chapter merge (minimum: 3)`);
    return false;
  }

  // All files must have same audio format
  const extensions = new Set(files.map(f => path.extname(f).toLowerCase()));
  if (extensions.size > 1) {
    await logger?.info(`Chapter detection: Mixed formats detected (${[...extensions].join(', ')}) - skipping merge`);
    return false;
  }

  // Must be a supported format
  const ext = [...extensions][0];
  if (!SUPPORTED_FORMATS.includes(ext)) {
    await logger?.info(`Chapter detection: Unsupported format (${ext}) - skipping merge`);
    return false;
  }

  // Passed basic checks - attempt merge
  await logger?.info(`Chapter detection: ${files.length} files with format ${ext} - attempting chapter merge`);
  return true;
}

/**
 * Probe an audio file to extract duration and metadata
 */
export async function probeAudioFile(filePath: string): Promise<AudioProbeResult> {
  const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;

  try {
    const { stdout } = await execPromise(command, { timeout: 30000 });
    const data = JSON.parse(stdout);

    const format = data.format || {};
    const tags = format.tags || {};

    // Duration in milliseconds
    const duration = Math.round((parseFloat(format.duration) || 0) * 1000);

    // Bitrate in kbps
    const bitrate = format.bit_rate ? Math.round(parseInt(format.bit_rate) / 1000) : undefined;

    // Track number (various possible tag names)
    let trackNumber: number | undefined;
    const trackStr = tags.track || tags.TRACK || tags['track-number'];
    if (trackStr) {
      // Handle "1/10" format
      const match = String(trackStr).match(/^(\d+)/);
      if (match) {
        trackNumber = parseInt(match[1]);
      }
    }

    // Title
    const title = tags.title || tags.TITLE || undefined;

    // File extension as format indicator
    const fileFormat = path.extname(filePath).toLowerCase().slice(1);

    return {
      duration,
      bitrate,
      trackNumber,
      title,
      format: fileFormat,
    };
  } catch (error) {
    throw new Error(`Failed to probe audio file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Natural sort comparison for filenames
 * Handles numeric sequences correctly: ch1, ch2, ch10 (not ch1, ch10, ch2)
 */
function naturalSortCompare(a: string, b: string): number {
  const aParts = a.split(/(\d+)/);
  const bParts = b.split(/(\d+)/);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || '';
    const bPart = bParts[i] || '';

    // Check if both parts are numeric
    const aNum = parseInt(aPart);
    const bNum = parseInt(bPart);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      const cmp = aPart.localeCompare(bPart, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

/**
 * Check if a title is generic (should be ignored)
 */
function isGenericTitle(title: string): boolean {
  return GENERIC_TITLE_PATTERNS.some(pattern => pattern.test(title.trim()));
}

/**
 * Extract chapter name from filename
 */
function extractChapterNameFromFilename(filename: string): string | null {
  const basename = path.basename(filename, path.extname(filename));

  // Try to extract meaningful name after chapter indicator
  // "01 - The Beginning" -> "The Beginning"
  // "Chapter 1 - Introduction" -> "Introduction"
  // "Book Title - 01 - Chapter Name" -> "Chapter Name"
  const patterns = [
    /[\s._-]+\d+[\s._-]+(.+)$/,             // "BookTitle - 01 - ChapterName" (extract after last digit sequence)
    /^\d+[\s._-]+(.+)$/,                    // "01 - Title" or "01_Title"
    /^chapter\s*\d+[\s._-]+(.+)$/i,         // "Chapter 1 - Title"
    /^ch\s*\d+[\s._-]+(.+)$/i,              // "Ch1 - Title"
    /^part\s*\d+[\s._-]+(.+)$/i,            // "Part 1 - Title"
  ];

  for (const pattern of patterns) {
    const match = basename.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      if (extracted.length > 0 && !isGenericTitle(extracted)) {
        return extracted;
      }
    }
  }

  return null;
}

/**
 * Get chapter title with priority: filename > metadata (if not book title) > fallback
 */
function getChapterTitle(file: ChapterFile, index: number): string {
  // Priority 1: Extract from filename (most reliable for chapter-specific names)
  const extracted = extractChapterNameFromFilename(file.filename);
  if (extracted) {
    return extracted;
  }

  // Priority 2: Title metadata (only if meaningful AND not the book title)
  if (file.titleMetadata && !file.titleIsBookTitle && !isGenericTitle(file.titleMetadata)) {
    return file.titleMetadata;
  }

  // Priority 3: Fallback to "Chapter X"
  return `Chapter ${index + 1}`;
}

/**
 * Detect if a title appearing in metadata is the book title (not chapter-specific)
 * Returns the book title if >80% of files have the same title metadata
 */
function detectBookTitle(files: { titleMetadata?: string }[]): string | null {
  if (files.length === 0) return null;

  // Count occurrences of each title
  const titleCounts = new Map<string, number>();
  let filesWithTitle = 0;

  for (const file of files) {
    if (file.titleMetadata && file.titleMetadata.trim().length > 0) {
      const title = file.titleMetadata.trim();
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
      filesWithTitle++;
    }
  }

  if (filesWithTitle === 0) return null;

  // Find most common title
  let mostCommonTitle: string | null = null;
  let maxCount = 0;

  for (const [title, count] of titleCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonTitle = title;
    }
  }

  // If >80% of files have the same title, it's likely the book title
  const threshold = files.length * 0.8;
  if (mostCommonTitle && maxCount >= threshold) {
    return mostCommonTitle;
  }

  return null;
}

/**
 * Analyze and order chapter files
 * Returns files in correct order with metadata populated
 */
export async function analyzeChapterFiles(
  filePaths: string[],
  logger?: JobLogger
): Promise<ChapterFile[]> {
  await logger?.info(`Analyzing ${filePaths.length} chapter files...`);

  // Probe all files in parallel
  const probePromises = filePaths.map(async (filePath) => {
    const probe = await probeAudioFile(filePath);
    return {
      path: filePath,
      filename: path.basename(filePath),
      duration: probe.duration,
      bitrate: probe.bitrate,
      trackNumber: probe.trackNumber,
      titleMetadata: probe.title,
      titleIsBookTitle: false, // Will be updated if book title detected
      chapterTitle: '', // Will be computed after ordering
    };
  });

  const files = await Promise.all(probePromises);

  // Log sample filenames for debugging
  const sampleCount = Math.min(3, files.length);
  const sampleFilenames = files.slice(0, sampleCount).map(f => f.filename);
  await logger?.info(`Sample filenames: ${sampleFilenames.join(', ')}${files.length > sampleCount ? ', ...' : ''}`);

  // Detect if title metadata is actually the book title (not chapter-specific)
  const bookTitle = detectBookTitle(files);
  if (bookTitle) {
    const filesWithBookTitle = files.filter(f => f.titleMetadata?.trim() === bookTitle).length;
    await logger?.info(`Detected book title in metadata: "${bookTitle}" (appears in ${filesWithBookTitle}/${files.length} files)`);

    // Flag all files that have the book title as metadata
    for (const file of files) {
      if (file.titleMetadata?.trim() === bookTitle) {
        file.titleIsBookTitle = true;
      }
    }

    await logger?.info(`Title metadata flagged as book title - will prioritize filename extraction for chapter names`);
  }

  // Create filename-based order (natural sort)
  const filenameOrder = [...files].sort((a, b) =>
    naturalSortCompare(a.filename, b.filename)
  );

  // Check if metadata order is available and valid
  const hasAllTrackNumbers = files.every(f => f.trackNumber !== undefined && f.trackNumber > 0);
  let useMetadataOrder = false;
  let metadataOrder: ChapterFile[] = [];

  await logger?.info(`Metadata analysis: ${files.filter(f => f.trackNumber).length}/${files.length} files have track numbers`);

  if (hasAllTrackNumbers) {
    metadataOrder = [...files].sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));

    // Log track number range
    const trackNumbers = metadataOrder.map(f => f.trackNumber);
    await logger?.info(`Track numbers: ${trackNumbers.slice(0, 3).join(', ')}${trackNumbers.length > 3 ? ` ... ${trackNumbers[trackNumbers.length - 1]}` : ''}`);

    // Check if track numbers are sequential
    const isSequential = metadataOrder.every((f, i) => {
      const expectedTrack = i + 1;
      return f.trackNumber === expectedTrack;
    });

    if (isSequential) {
      // Compare orders
      const ordersMatch = filenameOrder.every((f, i) => f.path === metadataOrder[i].path);

      if (ordersMatch) {
        await logger?.info('Chapter ordering: Filename and metadata orders match - high confidence');
      } else {
        await logger?.info('Chapter ordering: Filename differs from metadata - using metadata order (more reliable)');
        useMetadataOrder = true;
      }
    } else {
      await logger?.warn('Chapter ordering: Track numbers not sequential (gaps or duplicates) - using filename order');
    }
  } else {
    const missingCount = files.filter(f => !f.trackNumber).length;
    await logger?.info(`Chapter ordering: ${missingCount} file(s) missing track numbers - using filename order`);
  }

  // Use the determined order
  const orderedFiles = useMetadataOrder ? metadataOrder : filenameOrder;

  // Log ordering decision summary
  await logger?.info(`Using ${useMetadataOrder ? 'metadata' : 'filename'}-based ordering for ${orderedFiles.length} chapters`);

  // Compute chapter titles
  for (let i = 0; i < orderedFiles.length; i++) {
    orderedFiles[i].chapterTitle = getChapterTitle(orderedFiles[i], i);
  }

  // Log sample chapter titles
  const sampleTitles = orderedFiles.slice(0, 3).map((f, i) => `Ch${i + 1}: "${f.chapterTitle}"`);
  await logger?.info(`Sample chapter titles: ${sampleTitles.join(', ')}${orderedFiles.length > 3 ? ', ...' : ''}`);

  return orderedFiles;
}

/**
 * Generate FFMETADATA1 format chapter metadata
 */
function generateChapterMetadata(chapters: ChapterFile[]): string {
  let metadata = ';FFMETADATA1\n';

  let currentTime = 0; // milliseconds

  for (const chapter of chapters) {
    const startTime = currentTime;
    const endTime = currentTime + chapter.duration;

    // Escape special characters in title
    const escapedTitle = chapter.chapterTitle
      .replace(/\\/g, '\\\\')
      .replace(/=/g, '\\=')
      .replace(/;/g, '\\;')
      .replace(/#/g, '\\#')
      .replace(/\n/g, '');

    metadata += '\n[CHAPTER]\n';
    metadata += 'TIMEBASE=1/1000\n';
    metadata += `START=${startTime}\n`;
    metadata += `END=${endTime}\n`;
    metadata += `title=${escapedTitle}\n`;

    currentTime = endTime;
  }

  return metadata;
}

/**
 * Determine optimal bitrate for MP3 conversion
 * Uses the average bitrate across all source files to preserve quality
 */
function determineOutputBitrate(chapters: ChapterFile[]): string {
  // Get all bitrates
  const bitrates = chapters
    .filter(c => c.bitrate !== undefined)
    .map(c => c.bitrate as number);

  if (bitrates.length === 0) {
    // No bitrate info available, use reasonable default
    return '128k';
  }

  // Calculate average bitrate
  const avgBitrate = Math.round(bitrates.reduce((sum, br) => sum + br, 0) / bitrates.length);

  // Cap at reasonable maximum (320k for MP3, which is max for most sources)
  const cappedBitrate = Math.min(avgBitrate, 320);

  // Floor at reasonable minimum (64k for audiobooks)
  const finalBitrate = Math.max(cappedBitrate, 64);

  return `${finalBitrate}k`;
}

/**
 * Map bitrate to native AAC VBR quality value
 * Quality range: 0.1-5 (higher = better quality/larger file)
 */
function bitrateToVbrQuality(bitrateStr: string): number {
  const bitrate = parseInt(bitrateStr.replace('k', ''));

  // Approximate mapping based on AAC VBR behavior
  if (bitrate <= 64) return 1.0;   // ~64kbps
  if (bitrate <= 96) return 1.5;   // ~96kbps
  if (bitrate <= 128) return 2.0;  // ~128kbps
  if (bitrate <= 160) return 2.5;  // ~160kbps
  if (bitrate <= 192) return 3.0;  // ~192kbps
  if (bitrate <= 256) return 4.0;  // ~256kbps
  return 4.5; // ~320kbps+ (max quality)
}

/**
 * Check if libfdk_aac encoder is available (higher quality than native AAC)
 */
async function checkLibFdkAac(): Promise<boolean> {
  try {
    const { stdout } = await execPromise('ffmpeg -encoders 2>&1', { timeout: 5000 });
    return stdout.includes('libfdk_aac');
  } catch {
    // ffmpeg not available or error checking - assume not available
    return false;
  }
}

/**
 * Execute FFmpeg command with real-time progress logging
 */
async function executeFFmpegWithProgress(
  command: string,
  timeout: number,
  expectedDuration: number, // milliseconds
  logger?: JobLogger
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Parse the command to extract args (remove 'ffmpeg' and handle quotes)
    const args = command
      .replace(/^ffmpeg\s+/, '')
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map(arg => arg.replace(/^"|"$/g, '')) || [];

    const ffmpeg = spawn('ffmpeg', args);

    let stderrBuffer = '';
    let lastProgressLog = Date.now();
    let lastProgressPercent = 0;

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      ffmpeg.kill();
      reject(new Error(`FFmpeg timeout after ${Math.ceil(timeout / 60000)} minutes`));
    }, timeout);

    // Capture stderr for progress and errors
    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      stderrBuffer += output;

      // Parse FFmpeg progress output
      // Format: frame=... fps=... q=... size=... time=HH:MM:SS.MS bitrate=... speed=...
      const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);

      if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseInt(timeMatch[3]);
        const currentTimeMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

        const progressPercent = Math.min(100, Math.round((currentTimeMs / expectedDuration) * 100));

        // Log progress every 10% or every 5 minutes (whichever comes first)
        const timeSinceLastLog = Date.now() - lastProgressLog;
        const percentChange = progressPercent - lastProgressPercent;

        if (percentChange >= 10 || timeSinceLastLog >= 5 * 60 * 1000) {
          // Also parse speed if available
          const speedMatch = output.match(/speed=\s*([\d.]+)x/);
          const speed = speedMatch ? parseFloat(speedMatch[1]) : null;

          const speedInfo = speed ? ` (${speed.toFixed(1)}x realtime)` : '';
          logger?.info(`Encoding progress: ${progressPercent}%${speedInfo} - ${formatDuration(currentTimeMs)} / ${formatDuration(expectedDuration)}`).catch(() => {});

          lastProgressLog = Date.now();
          lastProgressPercent = progressPercent;
        }
      }
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeoutHandle);

      if (code === 0) {
        // Check stderr for errors even if exit code is 0
        if (stderrBuffer.includes('Error') || stderrBuffer.includes('Invalid')) {
          logger?.warn(`FFmpeg completed but reported issues: ${stderrBuffer.substring(stderrBuffer.lastIndexOf('Error'), stderrBuffer.lastIndexOf('Error') + 200)}`).catch(() => {});
        }
        resolve();
      } else {
        // Extract meaningful error from stderr
        const errorLines = stderrBuffer.split('\n').filter(line =>
          line.includes('Error') || line.includes('Invalid') || line.includes('failed')
        );
        const errorMsg = errorLines.length > 0
          ? errorLines.slice(-3).join('; ')
          : `FFmpeg exited with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    ffmpeg.on('error', (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
  });
}

/**
 * Merge chapter files into a single M4B with chapter markers
 */
export async function mergeChapters(
  chapters: ChapterFile[],
  options: MergeOptions,
  logger?: JobLogger
): Promise<MergeResult> {
  if (chapters.length === 0) {
    await logger?.error('Chapter merge failed: No chapters provided');
    return { success: false, error: 'No chapters to merge' };
  }

  const tempDir = path.dirname(options.outputPath);
  const concatFile = path.join(tempDir, `concat_${Date.now()}.txt`);
  const metadataFile = path.join(tempDir, `chapters_${Date.now()}.txt`);

  try {
    await logger?.info(`Starting chapter merge: "${options.title}" by ${options.author}`);
    await logger?.info(`Output: ${path.basename(options.outputPath)}`);

    // Calculate total duration and estimated size
    const totalDuration = chapters.reduce((sum, c) => sum + c.duration, 0);
    const estimatedSize = await estimateOutputSize(chapters.map(c => c.path));
    await logger?.info(`Total duration: ${formatDuration(totalDuration)}, Estimated size: ${Math.round(estimatedSize / 1024 / 1024)}MB`);

    // Validate all source files are readable and not corrupt
    await logger?.info('Validating source files...');
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      try {
        await fs.access(chapter.path, fs.constants.R_OK);

        // Quick probe to verify file is valid (use cached data if available)
        // This catches obviously corrupt source files before we try to merge
        const stats = await fs.stat(chapter.path);
        if (stats.size === 0) {
          throw new Error(`File ${i + 1}/${chapters.length} (${path.basename(chapter.path)}) is empty (0 bytes)`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Source file validation failed at file ${i + 1}/${chapters.length} (${path.basename(chapter.path)}): ${errorMsg}`);
      }
    }
    await logger?.info(`✓ All ${chapters.length} source files validated`);

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Create concat file
    const concatContent = chapters
      .map(c => `file '${c.path.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.writeFile(concatFile, concatContent);
    await logger?.info(`Created concat list with ${chapters.length} files`);

    // Create chapter metadata file
    const chapterMetadata = generateChapterMetadata(chapters);
    await fs.writeFile(metadataFile, chapterMetadata);
    await logger?.info(`Generated chapter metadata with ${chapters.length} chapter markers`);

    // Determine if we need to re-encode (MP3 input requires conversion to AAC)
    const inputFormat = path.extname(chapters[0].path).toLowerCase();
    const needsReencode = inputFormat === '.mp3';

    // Build ffmpeg command
    const args: string[] = [
      'ffmpeg',
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', `"${concatFile}"`,
      '-i', `"${metadataFile}"`,
      '-map_metadata', '1',
      '-map', '0:a', // Explicit audio stream mapping
    ];

    if (needsReencode) {
      // MP3 -> M4B requires re-encoding to AAC
      const bitrate = determineOutputBitrate(chapters);

      // Check for libfdk_aac (higher quality) or fall back to native aac
      const hasFdkAac = await checkLibFdkAac();

      if (hasFdkAac) {
        args.push('-c:a', 'libfdk_aac');
        args.push('-vbr', '4'); // VBR mode 4 (~128-160kbps, high quality)
        await logger?.info(`Merge strategy: Re-encoding MP3 → AAC/M4B using libfdk_aac (high quality VBR, target ~${bitrate})`);
      } else {
        // Use VBR for better quality at same average bitrate
        const vbrQuality = bitrateToVbrQuality(bitrate);
        args.push('-c:a', 'aac');
        args.push('-q:a', vbrQuality.toString());
        args.push('-profile:a', 'aac_low'); // AAC-LC profile for maximum compatibility
        await logger?.info(`Merge strategy: Re-encoding MP3 → AAC/M4B using native AAC VBR (quality ${vbrQuality}, target ~${bitrate})`);
      }
    } else {
      // M4A/M4B -> M4B can use codec copy (fast, lossless)
      args.push('-c', 'copy');
      await logger?.info(`Merge strategy: Codec copy (lossless, fast - no re-encoding needed for ${inputFormat} input)`);
    }

    // Add critical flags for reliability and performance
    args.push('-movflags', '+faststart'); // CRITICAL: Move moov atom to beginning (fixes slow playback)
    args.push('-fflags', '+genpts'); // Regenerate presentation timestamps (fixes timing issues)
    args.push('-avoid_negative_ts', 'make_zero'); // Handle negative timestamps
    args.push('-max_muxing_queue_size', '9999'); // Prevent buffer overflow on long files

    // Add book metadata
    const escapeMetadata = (val: string): string =>
      val.replace(/"/g, '\\"').replace(/'/g, "\\'");

    args.push('-metadata', `title="${escapeMetadata(options.title)}"`);
    args.push('-metadata', `album="${escapeMetadata(options.title)}"`);
    args.push('-metadata', `album_artist="${escapeMetadata(options.author)}"`);
    args.push('-metadata', `artist="${escapeMetadata(options.author)}"`);

    if (options.narrator) {
      args.push('-metadata', `composer="${escapeMetadata(options.narrator)}"`);
    }

    if (options.year) {
      args.push('-metadata', `date="${options.year}"`);
    }

    if (options.asin) {
      // Custom iTunes tag for ASIN
      args.push('-metadata', `----:com.apple.iTunes:ASIN="${escapeMetadata(options.asin)}"`);
      await logger?.info(`Embedding ASIN: ${options.asin}`);
    }

    // Output format
    args.push('-f', 'mp4');
    args.push(`"${options.outputPath}"`);

    const command = args.join(' ');

    // Calculate timeout based on operation type and total duration
    const totalDurationMinutes = totalDuration / 1000 / 60;

    const timeout = needsReencode
      ? Math.max(
          90 * 60 * 1000, // Minimum 90 minutes for re-encoding
          Math.round((totalDurationMinutes / 5) * 60 * 1000) + (60 * 60 * 1000) // duration/5 (worst case 5x realtime) + 60min safety margin
        )
      : (5 * 60 * 1000) + (chapters.length * 30 * 1000); // Codec copy: 5min + 30s per chapter

    const timeoutMinutes = Math.ceil(timeout / 60000);

    await logger?.info(`Executing FFmpeg merge (timeout: ${timeoutMinutes} minutes)...`);

    if (needsReencode && totalDurationMinutes > 60) {
      const estimatedMinEncoding = Math.round(totalDurationMinutes / 10); // Best case: 10x realtime
      const estimatedMaxEncoding = Math.round(totalDurationMinutes / 5);  // Worst case: 5x realtime
      await logger?.info(`This is a long audiobook (${Math.round(totalDurationMinutes / 60)}h). Encoding may take ${estimatedMinEncoding}-${estimatedMaxEncoding} minutes depending on CPU speed.`);
    }

    // Log command for debugging (truncate if too long)
    const commandPreview = command.length > 500 ? command.substring(0, 500) + '...' : command;
    await logger?.info(`FFmpeg command: ${commandPreview}`);

    // Execute FFmpeg with progress logging
    try {
      await executeFFmpegWithProgress(command, timeout, totalDuration, logger);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await logger?.error(`FFmpeg merge failed: ${errorMsg}`);
      throw new Error(`FFmpeg merge failed: ${errorMsg}`);
    }

    // Verify output file exists
    try {
      await fs.access(options.outputPath);
    } catch {
      await logger?.error('Merge failed: Output file not created');
      throw new Error('Merged file not created');
    }

    // Validate merged file
    const validation = await validateMergedFile(options.outputPath, totalDuration, logger);

    if (!validation.valid) {
      await logger?.error(`Output validation failed: ${validation.error}`);
      // Delete corrupt file
      try {
        await fs.unlink(options.outputPath);
        await logger?.info('Deleted corrupt output file');
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Merge validation failed: ${validation.error}`);
    }

    // Get actual output file size
    const stats = await fs.stat(options.outputPath);
    const actualSizeMB = Math.round(stats.size / 1024 / 1024);

    await logger?.info(`✓ Chapter merge successful!`);
    await logger?.info(`  - Chapters: ${chapters.length}`);
    await logger?.info(`  - Duration: ${formatDuration(validation.actualDuration || totalDuration)}`);
    await logger?.info(`  - Size: ${actualSizeMB}MB`);
    await logger?.info(`  - Format: M4B with embedded chapter markers`);
    await logger?.info(`  - Validation: Passed (duration accurate, file playable)`);

    return {
      success: true,
      outputPath: options.outputPath,
      chapterCount: chapters.length,
      totalDuration,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await logger?.error(`Chapter merge failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  } finally {
    // Clean up temp files
    try {
      await fs.unlink(concatFile);
      await logger?.info('Cleaned up temporary concat file');
    } catch {
      // Ignore cleanup errors
    }
    try {
      await fs.unlink(metadataFile);
      await logger?.info('Cleaned up temporary metadata file');
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Validate merged M4B file
 * Checks duration accuracy and playability to catch corruption
 */
async function validateMergedFile(
  outputPath: string,
  expectedDuration: number, // milliseconds
  logger?: JobLogger
): Promise<{ valid: boolean; error?: string; actualDuration?: number }> {
  try {
    await logger?.info('Validating merged file...');

    // 1. Probe output file to get actual duration
    const probe = await probeAudioFile(outputPath);
    const actualDuration = probe.duration;

    await logger?.info(`Duration check: expected ${formatDuration(expectedDuration)}, got ${formatDuration(actualDuration)}`);

    // 2. Check duration match (within 2% tolerance for encoding variations)
    const durationDiff = Math.abs(actualDuration - expectedDuration);
    const tolerance = expectedDuration * 0.02; // 2% tolerance

    if (durationDiff > tolerance) {
      const percentDiff = ((durationDiff / expectedDuration) * 100).toFixed(1);
      return {
        valid: false,
        error: `Duration mismatch (${percentDiff}% off): expected ${formatDuration(expectedDuration)}, got ${formatDuration(actualDuration)}. File may be truncated or corrupted.`,
        actualDuration
      };
    }

    // 3. Fast decode test - verify beginning and end of file are playable
    // This catches truncation/corruption without decoding entire file
    await logger?.info('Testing file integrity (first and last 10 seconds)...');

    try {
      // Test first 10 seconds
      const firstDecodeCommand = `ffmpeg -v error -i "${outputPath}" -t 10 -f null -`;
      await execPromise(firstDecodeCommand, { timeout: 30000 }); // 30 sec timeout

      // Test last 10 seconds (seeks to 10 seconds before end)
      const lastDecodeCommand = `ffmpeg -v error -sseof -10 -i "${outputPath}" -f null -`;
      await execPromise(lastDecodeCommand, { timeout: 30000 }); // 30 sec timeout

      await logger?.info('✓ File integrity test passed (beginning and end playable)');
    } catch (decodeError) {
      const errorMsg = decodeError instanceof Error ? decodeError.message : 'Unknown error';
      return {
        valid: false,
        error: `File integrity test failed: ${errorMsg}. File may be corrupted or truncated.`,
        actualDuration
      };
    }

    // 4. File size sanity check
    const stats = await fs.stat(outputPath);
    const sizeMB = stats.size / 1024 / 1024;
    const durationMinutes = expectedDuration / 1000 / 60;
    const expectedMinSize = durationMinutes * 0.4; // ~0.4MB per minute minimum (accommodates 64kbps encoding)

    if (sizeMB < expectedMinSize) {
      return {
        valid: false,
        error: `File size too small (${Math.round(sizeMB)}MB) for ${formatDuration(expectedDuration)} duration. Expected at least ${Math.round(expectedMinSize)}MB. File may be truncated.`,
        actualDuration
      };
    }

    await logger?.info(`✓ Validation passed: duration ${formatDuration(actualDuration)}, size ${Math.round(sizeMB)}MB`);

    return { valid: true, actualDuration };
  } catch (error) {
    return {
      valid: false,
      error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Check available disk space in directory
 * Returns available bytes, or null if unable to determine
 */
export async function checkDiskSpace(directory: string): Promise<number | null> {
  try {
    // Use df on Unix-like systems
    const { stdout } = await execPromise(`df -k "${directory}" | tail -1 | awk '{print $4}'`);
    const availableKb = parseInt(stdout.trim());
    if (!isNaN(availableKb)) {
      return availableKb * 1024; // Convert to bytes
    }
  } catch {
    // df not available (Windows) or other error
  }

  return null;
}

/**
 * Estimate output file size (sum of inputs + 10% overhead)
 */
export async function estimateOutputSize(filePaths: string[]): Promise<number> {
  let totalSize = 0;

  for (const filePath of filePaths) {
    try {
      const stats = await fs.stat(filePath);
      totalSize += stats.size;
    } catch {
      // Ignore errors, estimate conservatively
    }
  }

  // Add 10% overhead for metadata and format differences
  return Math.ceil(totalSize * 1.1);
}
