/**
 * Component: Setup Wizard Test Paths API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

async function testPath(dirPath: string): Promise<boolean> {
  try {
    // Check if path exists
    await fs.access(dirPath);

    // Try to create a test file
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
        errors.push('Download directory is not accessible or writable');
      }
      if (!mediaDirValid) {
        errors.push('Media directory is not accessible or writable');
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
      message: 'Both directories are valid and writable',
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
