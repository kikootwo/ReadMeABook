/**
 * Component: Audiobookshelf Type Definitions
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

export interface ABSLibrary {
  id: string;
  name: string;
  mediaType: 'book' | 'podcast';
  folders: { id: string; fullPath: string }[];
  stats?: {
    totalItems: number;
  };
}

export interface ABSBookMetadata {
  title: string;
  subtitle?: string;
  authorName: string;
  authorNameLF?: string;
  narratorName?: string;
  seriesName?: string;
  genres: string[];
  publishedYear?: string;
  description?: string;
  isbn?: string;
  asin?: string;
  language?: string;
  explicit: boolean;
}

export interface ABSAudioFile {
  index: number;
  ino: string;
  metadata: {
    filename: string;
    ext: string;
    path: string;
    size: number;
    mtimeMs: number;
  };
  duration: number;
}

export interface ABSLibraryItem {
  id: string;
  ino: string;
  libraryId: string;
  folderId: string;
  path: string;
  relPath: string;
  isFile: boolean;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  addedAt: number;
  updatedAt: number;
  isMissing: boolean;
  isInvalid: boolean;
  mediaType: 'book';
  media: {
    metadata: ABSBookMetadata;
    coverPath?: string;
    audioFiles: ABSAudioFile[];
    duration: number;
    size: number;
    numTracks: number;
    numAudioFiles: number;
  };
  numFiles: number;
  size: number;
}
