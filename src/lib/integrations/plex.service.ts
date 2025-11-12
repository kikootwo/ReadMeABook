/**
 * Component: Plex Media Server Integration Service
 * Documentation: documentation/integrations/plex.md
 */

import axios, { AxiosInstance } from 'axios';
import { parseStringPromise } from 'xml2js';

const PLEX_TV_API_BASE = 'https://plex.tv/api/v2';
const PLEX_CLIENT_IDENTIFIER = process.env.PLEX_CLIENT_IDENTIFIER || 'readmeabook-unique-client-id';
const PLEX_PRODUCT_NAME = process.env.PLEX_PRODUCT_NAME || 'ReadMeABook';

export interface PlexPin {
  id: number;
  code: string;
  authToken?: string;
}

export interface PlexUser {
  id: number;
  username: string;
  email?: string;
  thumb?: string;
  authToken: string;
}

export interface PlexLibrary {
  id: string;
  title: string;
  type: string;
  language: string;
  scanner: string;
  agent: string;
  locations: string[];
  itemCount?: number;
}

export interface PlexAudiobook {
  ratingKey: string;
  guid: string;
  title: string;
  author?: string;
  narrator?: string;
  duration?: number;
  year?: number;
  summary?: string;
  thumb?: string;
  addedAt: number;
  updatedAt: number;
  filePath?: string;
}

export interface PlexServerInfo {
  machineIdentifier: string;
  version: string;
  platform: string;
  platformVersion?: string;
}

export class PlexService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 10000,
    });
  }

  /**
   * Request a new PIN for OAuth authentication
   */
  async requestPin(): Promise<PlexPin> {
    try {
      const response = await this.client.post(
        `${PLEX_TV_API_BASE}/pins`,
        {
          strong: true,
        },
        {
          headers: {
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
            'X-Plex-Product': PLEX_PRODUCT_NAME,
          },
        }
      );

      return {
        id: response.data.id,
        code: response.data.code,
      };
    } catch (error) {
      console.error('Failed to request Plex PIN:', error);
      throw new Error('Failed to request authentication PIN from Plex');
    }
  }

  /**
   * Check PIN status (poll until user authorizes)
   */
  async checkPin(pinId: number): Promise<string | null> {
    try {
      const response = await this.client.get(`${PLEX_TV_API_BASE}/pins/${pinId}`, {
        headers: {
          'Accept': 'application/json',
          'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        },
      });

      return response.data.authToken || null;
    } catch (error) {
      console.error('Failed to check Plex PIN:', error);
      return null;
    }
  }

  /**
   * Get user information using auth token
   */
  async getUserInfo(authToken: string): Promise<PlexUser> {
    try {
      const response = await this.client.get('https://plex.tv/users/account', {
        headers: {
          'Accept': 'application/json',
          'X-Plex-Token': authToken,
        },
      });

      let userData: any;

      // Handle different response formats from Plex
      if (typeof response.data === 'string') {
        // XML response - parse it
        console.log('[Plex] Received XML response, parsing...');
        const parsed = await parseStringPromise(response.data);

        // XML attributes are in user.$
        if (parsed.user && parsed.user.$) {
          userData = parsed.user.$;
        } else {
          console.error('[Plex] Unexpected XML structure:', parsed);
          throw new Error('Unexpected XML structure in Plex response');
        }
      } else if (response.data && typeof response.data === 'object') {
        // JSON response
        console.log('[Plex] Received JSON response');
        userData = response.data;
      } else {
        console.error('[Plex] Unexpected response type:', typeof response.data);
        throw new Error('Unexpected response format from Plex');
      }

      console.log('[Plex] Parsed user data:', JSON.stringify(userData, null, 2));

      // Validate required fields
      if (!userData.id) {
        console.error('[Plex] User ID missing from parsed data:', userData);
        throw new Error('User ID missing from Plex response');
      }

      const username = userData.username || userData.title;
      if (!username) {
        console.error('[Plex] Username missing from parsed data:', userData);
        throw new Error('Username missing from Plex response');
      }

      return {
        id: parseInt(userData.id, 10),
        username,
        email: userData.email || undefined,
        thumb: userData.thumb || undefined,
        authToken,
      };
    } catch (error) {
      console.error('Failed to get Plex user info:', error);
      if (error instanceof Error) {
        throw error; // Re-throw our custom errors
      }
      throw new Error('Failed to retrieve user information from Plex');
    }
  }

  /**
   * Generate Plex OAuth URL
   */
  getOAuthUrl(pinCode: string, pinId: number): string {
    const baseCallbackUrl = process.env.PLEX_OAUTH_CALLBACK_URL || 'http://localhost:3030/api/auth/plex/callback';
    const callbackUrl = encodeURIComponent(`${baseCallbackUrl}?pinId=${pinId}`);
    return `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_IDENTIFIER}&code=${pinCode}&context[device][product]=${PLEX_PRODUCT_NAME}&forwardUrl=${callbackUrl}`;
  }

  /**
   * Test connection to Plex server
   */
  async testConnection(serverUrl: string, authToken: string): Promise<{ success: boolean; message: string; info?: PlexServerInfo }> {
    try {
      const response = await this.client.get(`${serverUrl}/identity`, {
        headers: {
          'X-Plex-Token': authToken,
          'Accept': 'application/json',
        },
      });

      let data = response.data;

      // Handle different response formats from Plex
      if (typeof data === 'string') {
        // XML response - parse it
        const parsed = await parseStringPromise(data);
        // XML attributes are in MediaContainer.$
        data = parsed.MediaContainer && parsed.MediaContainer.$
          ? parsed.MediaContainer.$
          : parsed.MediaContainer || {};
      } else if (data && typeof data === 'object') {
        // JSON response - could be direct object or wrapped in MediaContainer
        if (data.MediaContainer) {
          // If wrapped, extract the MediaContainer object
          data = data.MediaContainer;
        }
        // else data is already the right format
      }

      console.log('[Plex] Identity response:', JSON.stringify(data, null, 2));

      const info: PlexServerInfo = {
        machineIdentifier: data.machineIdentifier || 'unknown',
        version: data.version || 'unknown',
        platform: data.platform || 'Plex Server',
        platformVersion: data.platformVersion,
      };

      return {
        success: true,
        message: `Connected to Plex server (${info.platform} v${info.version})`,
        info,
      };
    } catch (error) {
      console.error('Plex connection test failed:', error);
      return {
        success: false,
        message: 'Could not connect to Plex server. Check server URL and token.',
      };
    }
  }

  /**
   * Get all libraries from Plex server
   */
  async getLibraries(serverUrl: string, authToken: string): Promise<PlexLibrary[]> {
    try {
      const response = await this.client.get(`${serverUrl}/library/sections`, {
        headers: {
          'X-Plex-Token': authToken,
          'Accept': 'application/json',
        },
      });

      let data = response.data;

      // Handle different response formats from Plex
      if (typeof data === 'string') {
        // XML response - parse it
        const parsed = await parseStringPromise(data);
        data = parsed.MediaContainer;
      } else if (data && typeof data === 'object') {
        // JSON response - could be wrapped in MediaContainer
        if (data.MediaContainer) {
          data = data.MediaContainer;
        }
      }

      const directories = data.Directory || [];

      const libraries = directories.map((dir: any) => ({
        id: (dir.key || dir.$?.key || '').toString(),
        title: dir.title || dir.$?.title || 'Unknown Library',
        type: dir.type || dir.$?.type || 'unknown',
        language: dir.language || dir.$?.language || 'en',
        scanner: dir.scanner || dir.$?.scanner || '',
        agent: dir.agent || dir.$?.agent || '',
        locations: Array.isArray(dir.Location)
          ? dir.Location.map((loc: any) => loc.path || loc.$?.path || '')
          : [],
      }));

      return libraries;
    } catch (error) {
      console.error('Failed to get Plex libraries:', error);
      throw new Error('Failed to retrieve libraries from Plex server');
    }
  }

  /**
   * Get all items from a library
   */
  async getLibraryContent(
    serverUrl: string,
    authToken: string,
    libraryId: string
  ): Promise<PlexAudiobook[]> {
    try {
      const response = await this.client.get(
        `${serverUrl}/library/sections/${libraryId}/all`,
        {
          params: {
            type: 9, // Type 9 = Albums (books in audiobook context)
          },
          headers: {
            'X-Plex-Token': authToken,
            'Accept': 'application/json',
          },
        }
      );

      console.log('[Plex] Library content response type:', typeof response.data);

      // Handle XML response
      let data = response.data;
      if (typeof data === 'string') {
        console.log('[Plex] Parsing XML response...');
        const parsed = await parseStringPromise(data);
        data = parsed.MediaContainer;
      } else if (data && typeof data === 'object') {
        // JSON response - could be wrapped in MediaContainer
        if (data.MediaContainer) {
          console.log('[Plex] Extracting from MediaContainer wrapper');
          data = data.MediaContainer;
        }
      }

      console.log('[Plex] Data structure keys:', Object.keys(data || {}));
      console.log('[Plex] Looking for content in: Metadata, Track, Directory, Album');

      const tracks = data.Metadata || data.Track || data.Directory || data.Album || [];
      console.log('[Plex] Found', Array.isArray(tracks) ? tracks.length : '(not an array)', 'items');

      if (!Array.isArray(tracks)) {
        console.warn('[Plex] tracks is not an array:', tracks);
        return [];
      }

      return tracks.map((item: any) => ({
        ratingKey: item.ratingKey || item.$?.ratingKey,
        guid: item.guid || item.$?.guid || '',
        title: item.title || item.$?.title, // Album title (book name)
        author: item.parentTitle || item.$?.parentTitle || item.originalTitle, // Artist name (author)
        narrator: item.writer || item.$?.writer,
        duration: item.duration ? parseInt(item.duration) : undefined,
        year: item.year ? parseInt(item.year) : undefined,
        summary: item.summary || item.$?.summary,
        thumb: item.thumb || item.$?.thumb,
        addedAt: item.addedAt ? parseInt(item.addedAt) : Date.now(),
        updatedAt: item.updatedAt ? parseInt(item.updatedAt) : Date.now(),
      }));
    } catch (error) {
      console.error('Failed to get library content:', error);
      throw new Error('Failed to retrieve content from Plex library');
    }
  }

  /**
   * Trigger library scan
   */
  async scanLibrary(serverUrl: string, authToken: string, libraryId: string): Promise<void> {
    try {
      await this.client.get(`${serverUrl}/library/sections/${libraryId}/refresh`, {
        headers: {
          'X-Plex-Token': authToken,
        },
      });

      console.log(`Triggered Plex library scan for library ${libraryId}`);
    } catch (error) {
      console.error('Failed to trigger Plex scan:', error);
      throw new Error('Failed to trigger Plex library scan');
    }
  }

  /**
   * Search library for specific title
   */
  async searchLibrary(
    serverUrl: string,
    authToken: string,
    libraryId: string,
    query: string
  ): Promise<PlexAudiobook[]> {
    try {
      const response = await this.client.get(
        `${serverUrl}/library/sections/${libraryId}/search`,
        {
          params: { title: query },
          headers: {
            'X-Plex-Token': authToken,
            'Accept': 'application/json',
          },
        }
      );

      // Handle XML response
      let data = response.data;
      if (typeof data === 'string') {
        const parsed = await parseStringPromise(data);
        data = parsed.MediaContainer;
      }

      const items = data.Metadata || [];

      return items.map((item: any) => ({
        ratingKey: item.ratingKey || item.$.ratingKey,
        guid: item.guid || item.$.guid || '',
        title: item.title || item.$.title,
        author: item.grandparentTitle || item.$.grandparentTitle,
        duration: item.duration ? parseInt(item.duration) : undefined,
        summary: item.summary || item.$.summary,
        thumb: item.thumb || item.$.thumb,
        addedAt: item.addedAt ? parseInt(item.addedAt) : Date.now(),
        updatedAt: item.updatedAt ? parseInt(item.updatedAt) : Date.now(),
      }));
    } catch (error) {
      console.error('Failed to search Plex library:', error);
      return [];
    }
  }
}

// Singleton instance
let plexService: PlexService | null = null;

export function getPlexService(): PlexService {
  if (!plexService) {
    plexService = new PlexService();
  }
  return plexService;
}
