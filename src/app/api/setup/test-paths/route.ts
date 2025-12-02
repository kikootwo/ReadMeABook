/**
 * Component: Setup Wizard Test Paths API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

async function testPath(dirPath: string): Promise<boolean> {
  try {
    // Try to access the path
    try {
      await fs.access(dirPath);
      console.log(`[Setup] Path exists: ${dirPath}`);
    } catch (accessError) {
      // Path doesn't exist, try to create it
      console.log(`[Setup] Path doesn't exist, creating: ${dirPath}`);
      try {
        await fs.mkdir(dirPath, { recursive: true });
        console.log(`[Setup] Successfully created path: ${dirPath}`);
      } catch (mkdirError) {
        console.error(`[Setup] Failed to create path ${dirPath}:`, mkdirError);
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
    console.error(`[Setup] Path test failed for ${dirPath}:`, error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { downloadDir, mediaDir } = await request.json();

    if (!downloadDir || !mediaDir) {
      return NextResponse.json(
        { success: false, error: 'Both directory paths are required' },
        { status: 400 }
      );
    }

    // Test both paths
    const downloadDirValid = await testPath(downloadDir);
    const mediaDirValid = await testPath(mediaDir);

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
        downloadDirValid,
        mediaDirValid,
        error: errors.join('. '),
      });
    }

    return NextResponse.json({
      success: true,
      downloadDirValid,
      mediaDirValid,
      message: 'Directories are ready and writable (created if needed)',
    });
  } catch (error) {
    console.error('[Setup] Path validation failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Path validation failed',
      },
      { status: 500 }
    );
  }
}
