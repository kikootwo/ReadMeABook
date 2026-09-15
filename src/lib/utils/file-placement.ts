import fs from 'fs/promises';
import { copyFile } from './copy-file';

export type FilePlacementMode = 'copy' | 'hardlink' | 'move';
export type HardlinkFallbackMode = 'fail' | 'copy';

export interface PlaceFileOptions {
  mode: FilePlacementMode;
  hardlinkFallback?: HardlinkFallbackMode;
}

async function sameFile(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceStat, targetStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(targetPath),
    ]);

    return sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino;
  } catch {
    return false;
  }
}

export async function placeFile(
  sourcePath: string,
  targetPath: string,
  options: PlaceFileOptions
): Promise<'copied' | 'hardlinked' | 'moved' | 'already-exists'> {
  if (await sameFile(sourcePath, targetPath)) {
    return 'already-exists';
  }

  try {
    await fs.unlink(targetPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  if (options.mode === 'hardlink') {
    try {
      await fs.link(sourcePath, targetPath);
      return 'hardlinked';
    } catch (error: any) {
      if (options.hardlinkFallback === 'copy') {
        await copyFile(sourcePath, targetPath);
        return 'copied';
      }

      throw new Error(
        `Hardlink failed from "${sourcePath}" to "${targetPath}": ${error?.message ?? error}`
      );
    }
  }

  if (options.mode === 'move') {
    await fs.rename(sourcePath, targetPath);
    return 'moved';
  }

  await copyFile(sourcePath, targetPath);
  return 'copied';
}