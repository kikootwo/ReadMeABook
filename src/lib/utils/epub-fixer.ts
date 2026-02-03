/**
 * Component: EPUB Kindle Compatibility Fixer
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Applies compatibility fixes to EPUB files for Kindle import.
 * Based on: https://github.com/innocenat/kindle-epub-fix
 *
 * Fixes applied:
 * 1. Encoding declaration - Adds UTF-8 XML declaration to files missing it
 * 2. Body ID link fix - Removes #bodyid fragments from hyperlinks
 * 3. Language validation - Ensures dc:language uses Amazon KDP-approved codes
 * 4. Stray IMG removal - Removes <img> tags without src attributes
 */

import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import path from 'path';
import fs from 'fs/promises';
import { RMABLogger } from './logger';

const moduleLogger = RMABLogger.create('EpubFixer');

/**
 * Amazon KDP approved language codes
 * Source: https://kdp.amazon.com/en_US/help/topic/G200673300
 */
const AMAZON_APPROVED_LANGUAGES: Set<string> = new Set([
  // ISO 639-1 codes (2-letter)
  'af', 'sq', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs', 'br', 'bg', 'ca',
  'zh', 'hr', 'cs', 'da', 'nl', 'en', 'eo', 'et', 'fo', 'fi', 'fr', 'fy',
  'gl', 'ka', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'is', 'id', 'ga', 'it',
  'ja', 'kn', 'kk', 'ko', 'ku', 'ky', 'la', 'lv', 'lt', 'lb', 'mk', 'ms',
  'ml', 'mt', 'mr', 'mn', 'ne', 'no', 'nb', 'nn', 'oc', 'or', 'ps', 'fa',
  'pl', 'pt', 'pa', 'rm', 'ro', 'ru', 'gd', 'sr', 'sk', 'sl', 'es', 'sw',
  'sv', 'tl', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'cy', 'yi',
  // ISO 639-2 codes (3-letter) commonly used
  'eng', 'fra', 'deu', 'spa', 'ita', 'por', 'rus', 'jpn', 'zho', 'kor',
  'ara', 'hin', 'nld', 'pol', 'tur', 'swe', 'dan', 'nor', 'fin', 'ces',
  // Regional variants
  'en-us', 'en-gb', 'en-au', 'en-ca', 'en-nz', 'en-ie', 'en-za',
  'pt-br', 'pt-pt', 'zh-cn', 'zh-tw', 'zh-hk', 'es-es', 'es-mx', 'es-ar',
  'fr-fr', 'fr-ca', 'de-de', 'de-at', 'de-ch', 'it-it', 'nl-nl', 'nl-be',
]);

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

  try {
    await logger?.info(`Starting Kindle EPUB fix for: ${path.basename(sourcePath)}`);

    // Verify source file exists
    try {
      await fs.access(sourcePath, fs.constants.R_OK);
    } catch {
      throw new Error(`Source EPUB not found or not readable: ${sourcePath}`);
    }

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

    // Create unique temp subdirectory to avoid filename conflicts
    // This preserves the original filename for the final organized file
    const uniqueDir = path.join(tempDir, `kindle-fix-${Date.now()}`);
    await fs.mkdir(uniqueDir, { recursive: true });

    // Keep original filename
    const sourceFilename = path.basename(sourcePath);
    const outputPath = path.join(uniqueDir, sourceFilename);

    // Write fixed EPUB
    zip.writeZip(outputPath);

    await logger?.info(`Fixed EPUB written to temp directory, preserving filename: ${sourceFilename}`);

    result.success = true;
    result.outputPath = outputPath;

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await logger?.error(`EPUB fix failed: ${errorMessage}`);
    result.error = errorMessage;
    return result;
  }
}

/**
 * Fix 1: Add UTF-8 XML encoding declaration if missing
 *
 * Many EPUBs lack the XML declaration, which can cause Kindle import issues.
 * Adds: <?xml version="1.0" encoding="utf-8"?>
 */
function fixEncoding(content: string): { content: string; modified: boolean } {
  // Check if already has XML declaration
  const xmlDeclRegex = /^\s*<\?xml[^?]*\?>/i;

  if (xmlDeclRegex.test(content)) {
    // Already has declaration, check if it has encoding
    const hasEncoding = /encoding\s*=\s*["'][^"']+["']/i.test(content);
    if (hasEncoding) {
      return { content, modified: false };
    }

    // Has declaration but no encoding - add encoding attribute
    const updatedContent = content.replace(
      /(<\?xml[^?]*?)(\?>)/i,
      '$1 encoding="utf-8"$2'
    );
    return { content: updatedContent, modified: true };
  }

  // No declaration - add one at the beginning
  const declaration = '<?xml version="1.0" encoding="utf-8"?>\n';
  return { content: declaration + content.trimStart(), modified: true };
}

/**
 * Fix 2: Remove body ID fragments from hyperlinks
 *
 * Links like "file.html#body" or "file.xhtml#bodymatter" can break on Kindle.
 * This removes the fragment when it targets body-related IDs.
 */
function fixBodyIdLinks(content: string): { content: string; modified: boolean; count: number } {
  // Pattern to match href attributes with body-related ID fragments
  // Matches: href="file.html#body", href="page.xhtml#bodymatter", etc.
  const bodyIdPattern = /href\s*=\s*["']([^"'#]+)#(body[^"']*|bodymatter)["']/gi;

  let count = 0;
  const updatedContent = content.replace(bodyIdPattern, (match, file) => {
    count++;
    return `href="${file}"`;
  });

  return {
    content: updatedContent,
    modified: count > 0,
    count,
  };
}

/**
 * Fix 3: Validate and fix dc:language in OPF metadata
 *
 * Ensures the language tag is one approved by Amazon KDP.
 * If invalid or missing, defaults to "en" (English).
 */
function fixLanguage(opfContent: string): {
  content: string;
  modified: boolean;
  originalLang: string;
  newLang: string;
} {
  const result = {
    content: opfContent,
    modified: false,
    originalLang: '',
    newLang: '',
  };

  // Parse with cheerio (XML mode)
  const $ = cheerio.load(opfContent, { xmlMode: true });

  // Find dc:language element (handle namespace variations)
  let langElement = $('dc\\:language, language');

  if (langElement.length === 0) {
    // No language tag found - add one
    // Find the metadata element to insert into
    const metadata = $('metadata');
    if (metadata.length > 0) {
      // Add language element
      metadata.append('\n    <dc:language>en</dc:language>');
      result.content = $.xml();
      result.modified = true;
      result.originalLang = '(missing)';
      result.newLang = 'en';
    }
    return result;
  }

  // Get current language value
  const currentLang = langElement.first().text().trim().toLowerCase();
  result.originalLang = currentLang;

  // Check if it's a valid Amazon language
  if (isValidAmazonLanguage(currentLang)) {
    return result; // No fix needed
  }

  // Try to normalize the language
  const normalizedLang = normalizeLanguage(currentLang);

  if (normalizedLang !== currentLang) {
    langElement.first().text(normalizedLang);
    result.content = $.xml();
    result.modified = true;
    result.newLang = normalizedLang;
  }

  return result;
}

/**
 * Check if a language code is approved by Amazon KDP
 */
function isValidAmazonLanguage(lang: string): boolean {
  const normalized = lang.toLowerCase().trim();

  // Direct match
  if (AMAZON_APPROVED_LANGUAGES.has(normalized)) {
    return true;
  }

  // Check base language (e.g., "en-us" -> "en")
  const baseLang = normalized.split('-')[0];
  return AMAZON_APPROVED_LANGUAGES.has(baseLang);
}

/**
 * Normalize a language code to an Amazon-approved format
 */
function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();

  // If already valid, return as-is
  if (isValidAmazonLanguage(normalized)) {
    return normalized;
  }

  // Try base language
  const baseLang = normalized.split('-')[0];
  if (AMAZON_APPROVED_LANGUAGES.has(baseLang)) {
    return baseLang;
  }

  // Common mappings for non-standard codes
  const mappings: Record<string, string> = {
    'english': 'en',
    'french': 'fr',
    'german': 'de',
    'spanish': 'es',
    'italian': 'it',
    'portuguese': 'pt',
    'russian': 'ru',
    'japanese': 'ja',
    'chinese': 'zh',
    'korean': 'ko',
    'dutch': 'nl',
    'polish': 'pl',
    'swedish': 'sv',
    'danish': 'da',
    'norwegian': 'no',
    'finnish': 'fi',
    'und': 'en', // "undetermined" -> default to English
    'mul': 'en', // "multiple" -> default to English
    '': 'en',    // empty -> default to English
  };

  return mappings[normalized] || 'en';
}

/**
 * Fix 4: Remove stray IMG tags without src attributes
 *
 * IMG tags without src attributes can cause Kindle import failures.
 */
function fixStrayImages(content: string): { content: string; modified: boolean; count: number } {
  // Parse with cheerio
  const $ = cheerio.load(content, { xmlMode: true });

  let count = 0;

  // Find all img tags
  $('img').each((_, element) => {
    const $img = $(element);
    const src = $img.attr('src');

    // Remove if src is missing or empty
    if (!src || src.trim() === '') {
      $img.remove();
      count++;
    }
  });

  if (count > 0) {
    return {
      content: $.xml(),
      modified: true,
      count,
    };
  }

  return { content, modified: false, count: 0 };
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
