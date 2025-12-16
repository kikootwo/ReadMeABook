/**
 * Library Service Interface
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

export interface ServerInfo {
  name: string;
  version: string;
  platform?: string;
  identifier: string;  // machineIdentifier (Plex) or serverId (ABS)
}

export interface Library {
  id: string;
  name: string;
  type: string;
  itemCount?: number;
}

export interface LibraryItem {
  id: string;              // ratingKey (Plex) or item id (ABS)
  externalId: string;      // plexGuid or abs_item_id
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverUrl?: string;
  duration?: number;       // seconds
  asin?: string;
  isbn?: string;
  year?: number;
  addedAt: Date;
  updatedAt: Date;
}

export interface LibraryConnectionResult {
  success: boolean;
  serverInfo?: ServerInfo;
  error?: string;
}

export interface ILibraryService {
  // Connection
  testConnection(): Promise<LibraryConnectionResult>;
  getServerInfo(): Promise<ServerInfo>;

  // Libraries
  getLibraries(): Promise<Library[]>;
  getLibraryItems(libraryId: string): Promise<LibraryItem[]>;
  getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]>;

  // Items
  getItem(itemId: string): Promise<LibraryItem | null>;
  searchItems(libraryId: string, query: string): Promise<LibraryItem[]>;

  // Scanning
  triggerLibraryScan(libraryId: string): Promise<void>;
}
