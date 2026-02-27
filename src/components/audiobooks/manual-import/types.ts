/**
 * Component: Manual Import Shared Types
 * Documentation: documentation/features/manual-import.md
 */

export interface RootEntry {
  name: string;
  path: string;
  icon: string;
}

export interface DirectoryEntry {
  name: string;
  type: 'directory';
  audioFileCount: number;
  subfolderCount: number;
  totalSize: number;
}

export interface AudioFileEntry {
  name: string;
  size: number;
}

export type SlideDirection = 'left' | 'right';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
