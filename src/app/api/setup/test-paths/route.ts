/**
 * Component: Setup Wizard Test Paths API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireSetupIncompleteOrAdmin } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { validateTemplate, generateMockPreviews } from '@/lib/utils/path-template.util';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Setup.TestPaths');

async function testPath(dirPath: string): Promise<boolean> {
  try {
    // Try to access the path
    try {
      await fs.access(dirPath);
      logger.debug('Path exists', { path: dirPath });
    } catch (accessError) {
      // Path doesn't exist, try to create it
      logger.debug('Path does not exist, creating', { path: dirPath });
      try {
        await fs.mkdir(dirPath, { recursive: true });
        logger.debug('Successfully created path', { path: dirPath });
      } catch (mkdirError) {
        logger.error('Failed to create path', { path: dirPath, error: mkdirError instanceof Error ? mkdirError.message : String(mkdirError) });
        // If mkdir fails, it means the parent mount doesn't exist or isn't writable
        return false;
      }
    }

    // Test write permissions by creating a test file
    const testFile = path.join(dirPath, '.readmeabook-test');
    await fs.writeFile(testFile, 'test');

    // Clean up test file
    await fs.unlink(testFile);

    return true;
  } catch (error) {
    logger.error('Path test failed', { path: dirPath, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export async function POST(request: NextRequest) {
  return requireSetupIncompleteOrAdmin(request, async (req) => {
  try {
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const { downloadDir, mediaDir, audiobookPathTemplate } = bodyResult.data;

    if (!downloadDir || !mediaDir) {
      return NextResponse.json(
        { success: false, error: 'Both directory paths are required' },
        { status: 400 }
      );
    }

    // Test both paths
    const downloadDirValid = await testPath(downloadDir);
    const mediaDirValid = await testPath(mediaDir);

    // Validate template if provided
    let templateValidation: {
      isValid: boolean;
      error?: string;
      previewPaths?: string[];
    } | undefined;

    if (audiobookPathTemplate) {
      const validation = validateTemplate(audiobookPathTemplate);
      templateValidation = {
        isValid: validation.valid,
        error: validation.error,
      };

      // Generate previews only if template is valid
      if (validation.valid) {
        templateValidation.previewPaths = generateMockPreviews(audiobookPathTemplate);
      }
    }

    const success = downloadDirValid && mediaDirValid;

    if (!success) {
      const errors = [];
      if (!downloadDirValid) {
        errors.push('Download directory path is invalid or parent mount is not writable');
      }
      if (!mediaDirValid) {
        errors.push('Media directory path is invalid or parent mount is not writable');
      }

      return NextResponse.json({
        success: false,
        downloadDir: {
          valid: downloadDirValid,
          error: downloadDirValid ? undefined : 'Download directory path is invalid or parent mount is not writable',
        },
        mediaDir: {
          valid: mediaDirValid,
          error: mediaDirValid ? undefined : 'Media directory path is invalid or parent mount is not writable',
        },
        template: templateValidation,
        error: errors.join('. '),
      });
    }

    return NextResponse.json({
      success: true,
      downloadDir: {
        valid: downloadDirValid,
      },
      mediaDir: {
        valid: mediaDirValid,
      },
      template: templateValidation,
      message: 'Directories are ready and writable (created if needed)',
    });
  } catch (error) {
    logger.error('Path validation failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Path validation failed',
      },
      { status: 500 }
    );
  }
  });
}
