/**
 * Component: EPUB Kindle Compatibility Fixer
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Applies compatibility fixes to EPUB files for Kindle import.
 * Based on: https://github.com/innocenat/kindle-epub-fix
 *
 * Fixes applied (implemented in epub-fixes.ts):
 * 1. Encoding declaration - Adds UTF-8 XML declaration to files missing it
 * 2. Body ID link fix - Removes #bodyid fragments from hyperlinks
 * 3. Language validation - Ensures dc:language uses Amazon KDP-approved codes
 * 4. Stray IMG removal - Removes <img> tags without src attributes
 *
 * The written copy is re-opened and checked (entry names, CRCs, sha256 of every entry
 * against what was meant to be written) before it is reported as a success; a copy that
 * fails is deleted and the caller imports the original instead.
 */

import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs/promises';
import { RMABLogger } from './logger';
import { getConfigService } from '../services/config.service';
import { intendedEntries, verifyWrittenEpub } from './epub-verify';
import { fixBodyIdLinks, fixEncoding, fixLanguage, fixStrayImages } from './epub-fixes';

const moduleLogger = RMABLogger.create('EpubFixer');

/**
 * Content file extensions that should be processed
 */
const CONTENT_EXTENSIONS = ['.html', '.xhtml', '.htm', '.xml'];

/**
 * Result of the EPUB fixing process
 */
export interface EpubFixResult {
  success: boolean;
  outputPath: string | null;
  fixesApplied: {
    encodingFixes: number;
    bodyIdLinkFixes: number;
    languageFix: boolean;
    strayImgFixes: number;
  };
  error?: string;
  /** True when the fixed copy was written but failed its read-back check (and was deleted). */
  verificationFailed?: boolean;
}

/**
 * Logger interface for job-aware logging
 */
interface LoggerConfig {
  jobId: string;
  context: string;
}

/**
 * Fix EPUB file for Kindle compatibility
 *
 * @param sourcePath - Path to the source EPUB file
 * @param tempDir - Directory to write the fixed EPUB to
 * @param loggerConfig - Optional logger configuration for job-aware logging
 * @returns Result with path to fixed EPUB or error
 */
export async function fixEpubForKindle(
  sourcePath: string,
  tempDir: string,
  loggerConfig?: LoggerConfig
): Promise<EpubFixResult> {
  const logger = loggerConfig
    ? RMABLogger.forJob(loggerConfig.jobId, loggerConfig.context)
    : null;

  const result: EpubFixResult = {
    success: false,
    outputPath: null,
    fixesApplied: {
      encodingFixes: 0,
      bodyIdLinkFixes: 0,
      languageFix: false,
      strayImgFixes: 0,
    },
  };

  // The temp folder of this run, removed again on every failure path
  let outputDir: string | null = null;
  const removeOutputDir = async () => {
    if (outputDir) await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    await logger?.info(`Starting Kindle EPUB fix for: ${path.basename(sourcePath)}`);

    // Verify source file exists
    try {
      await fs.access(sourcePath, fs.constants.R_OK);
    } catch {
      throw new Error(`Source EPUB not found or not readable: ${sourcePath}`);
    }

    // The in-memory zip lives only inside writeFixedEpub, so it can be collected before the
    // written copy is read back (keeps peak memory lower for large EPUBs)
    const { outputPath, sourceFilename, intended } = await writeFixedEpub(sourcePath, tempDir, result, logger, (dir) => {
      outputDir = dir;
    });

    // Read the copy back: only one that matches what was meant to be written may be
    // imported (a truncated or corrupted copy would replace the original)
    const problem = verifyWrittenEpub(outputPath, intended);
    if (problem) {
      await removeOutputDir();
      const message = `Fixed EPUB failed verification: ${problem}`;
      if (logger) await logger.warn(message);
      else moduleLogger.warn(message);
      result.error = message;
      result.verificationFailed = true;
      return result;
    }

    await logger?.info(`Fixed EPUB written to temp directory, preserving filename: ${sourceFilename}`);

    result.success = true;
    result.outputPath = outputPath;

    return result;
  } catch (error) {
    await removeOutputDir();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await logger?.error(`EPUB fix failed: ${errorMessage}`);
    result.error = errorMessage;
    return result;
  }
}

type JobLogger = ReturnType<typeof RMABLogger.forJob>;

/**
 * Load the EPUB, apply the fixes (counted on `result.fixesApplied`), write the fixed copy
 * into a new temp folder (reported through onOutputDir as soon as it exists) and return
 * the sha256 per entry of what was meant to be written.
 */
async function writeFixedEpub(
  sourcePath: string,
  tempDir: string,
  result: EpubFixResult,
  logger: JobLogger | null,
  onOutputDir: (dir: string) => void
): Promise<{ outputPath: string; sourceFilename: string; intended: Map<string, string | null> }> {
  // Load the EPUB (ZIP file)
  const zip = new AdmZip(sourcePath);
  const zipEntries = zip.getEntries();

  await logger?.info(`Loaded EPUB with ${zipEntries.length} entries`);

  // Track OPF file for language fix
  let opfEntry: AdmZip.IZipEntry | null = null;
  let opfPath = '';

  // Find content files and OPF
  for (const entry of zipEntries) {
    const entryPath = entry.entryName.toLowerCase();

    // Find OPF file (metadata)
    if (entryPath.endsWith('.opf')) {
      opfEntry = entry;
      opfPath = entry.entryName;
    }
  }

  // Process content files (HTML/XHTML)
  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;

    const ext = path.extname(entry.entryName).toLowerCase();
    if (!CONTENT_EXTENSIONS.includes(ext)) continue;

    // Read file content
    let content = entry.getData().toString('utf8');
    let modified = false;

    // Fix 1: Encoding declaration
    const encodingResult = fixEncoding(content);
    if (encodingResult.modified) {
      content = encodingResult.content;
      modified = true;
      result.fixesApplied.encodingFixes++;
    }

    // Fix 2: Body ID links
    const bodyIdResult = fixBodyIdLinks(content);
    if (bodyIdResult.modified) {
      content = bodyIdResult.content;
      modified = true;
      result.fixesApplied.bodyIdLinkFixes += bodyIdResult.count;
    }

    // Fix 4: Stray IMG tags (applied to HTML content)
    const strayImgResult = fixStrayImages(content);
    if (strayImgResult.modified) {
      content = strayImgResult.content;
      modified = true;
      result.fixesApplied.strayImgFixes += strayImgResult.count;
    }

    // Update entry if modified
    if (modified) {
      zip.updateFile(entry.entryName, Buffer.from(content, 'utf8'));
    }
  }

  // Fix 3: Language validation (in OPF file)
  if (opfEntry) {
    const opfContent = opfEntry.getData().toString('utf8');
    const languageResult = fixLanguage(opfContent);

    if (languageResult.modified) {
      zip.updateFile(opfPath, Buffer.from(languageResult.content, 'utf8'));
      result.fixesApplied.languageFix = true;
      await logger?.info(`Fixed language tag: "${languageResult.originalLang}" -> "${languageResult.newLang}"`);
    }
  }

  // Log fixes applied
  const totalFixes =
    result.fixesApplied.encodingFixes +
    result.fixesApplied.bodyIdLinkFixes +
    (result.fixesApplied.languageFix ? 1 : 0) +
    result.fixesApplied.strayImgFixes;

  if (totalFixes > 0) {
    await logger?.info(
      `Applied ${totalFixes} fixes: ` +
      `encoding=${result.fixesApplied.encodingFixes}, ` +
      `bodyIdLinks=${result.fixesApplied.bodyIdLinkFixes}, ` +
      `language=${result.fixesApplied.languageFix}, ` +
      `strayImages=${result.fixesApplied.strayImgFixes}`
    );
  } else {
    await logger?.info('No fixes needed - EPUB is already Kindle-compatible');
  }

  // Create a unique temp subdirectory (mkdtemp: no collision between concurrent jobs)
  // This preserves the original filename for the final organized file
  const configService = getConfigService();
  const dirChmodStr = await configService.get('dir_chmod') || '775';
  const dirMode = parseInt(dirChmodStr, 8);
  await fs.mkdir(tempDir, { recursive: true, mode: dirMode });
  const uniqueDir = await fs.mkdtemp(path.join(tempDir, 'kindle-fix-'));
  onOutputDir(uniqueDir);
  await fs.chmod(uniqueDir, dirMode);

  // Keep original filename
  const sourceFilename = path.basename(sourcePath);
  const outputPath = path.join(uniqueDir, sourceFilename);

  // Record what is meant to be written, then write it
  const intended = intendedEntries(zip);
  zip.writeZip(outputPath);
  return { outputPath, sourceFilename, intended };
}

/**
 * Check if a file is an EPUB based on extension
 */
export function isEpubFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.epub';
}

/**
 * Clean up a temporary fixed EPUB file and its parent directory
 * The parent directory is a unique temp dir created during the fix process
 */
export async function cleanupFixedEpub(fixedPath: string): Promise<void> {
  try {
    // Remove the file first
    await fs.unlink(fixedPath);

    // Remove the parent temp directory (e.g., kindle-fix-1234567890)
    const parentDir = path.dirname(fixedPath);
    if (parentDir.includes('kindle-fix-')) {
      await fs.rmdir(parentDir);
    }

    moduleLogger.debug(`Cleaned up fixed EPUB and temp directory: ${path.basename(fixedPath)}`);
  } catch {
    // Ignore cleanup errors
  }
}
