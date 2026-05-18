/**
 * Component: Plex Media Server Integration Service
 * Documentation: documentation/integrations/plex.md
 */

import axios, { AxiosInstance } from 'axios';
import { RMAB_USER_AGENT } from '../utils/user-agent';
import { parseStringPromise } from 'xml2js';
import { RMABLogger } from '../utils/logger';

// Module-level logger
const logger = RMABLogger.create('Plex');

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
  userRating?: number;
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

export interface PlexHomeUser {
  id: string;
  uuid: string;
  title: string;
  friendlyName: string;
  username: string;
  email: string;
  thumb: string;
  hasPassword: boolean;
  restricted: boolean;
  admin: boolean;
  guest: boolean;
  protected: boolean;
}

export class PlexService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 10000,
      headers: { 'User-Agent': RMAB_USER_AGENT },
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
      logger.error('Failed to request PIN', { error: error instanceof Error ? error.message : String(error) });
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
      logger.error('Failed to check PIN', { error: error instanceof Error ? error.message : String(error) });
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
        logger.debug('Received XML response, parsing...');
        const parsed = await parseStringPromise(response.data);

        // XML attributes are in user.$
        if (parsed.user && parsed.user.$) {
          userData = parsed.user.$;
        } else {
          logger.error('Unexpected XML structure', { parsed });
          throw new Error('Unexpected XML structure in Plex response');
        }
      } else if (response.data && typeof response.data === 'object') {
        // JSON response
        logger.debug('Received JSON response');
        userData = response.data;
      } else {
        logger.error('Unexpected response type', { type: typeof response.data });
        throw new Error('Unexpected response format from Plex');
      }

      logger.debug('Parsed user data', { userData });

      // Validate required fields
      if (!userData.id) {
        logger.error('User ID missing from parsed data', { userData });
        throw new Error('User ID missing from Plex response');
      }

      const username = userData.username || userData.title;
      if (!username) {
        logger.error('Username missing from parsed data', { userData });
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
      logger.error('Failed to get user info', { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error) {
        throw error; // Re-throw our custom errors
      }
      throw new Error('Failed to retrieve user information from Plex');
    }
  }

  /**
   * Generate Plex OAuth URL
   */
  getOAuthUrl(pinCode: string, pinId: number, baseCallbackUrl?: string): string {
    // Use provided callback URL, or fall back to env var, or localhost
    const callbackBase = baseCallbackUrl || process.env.PLEX_OAUTH_CALLBACK_URL || 'http://localhost:3030/api/auth/plex/callback';
    const callbackUrl = encodeURIComponent(`${callbackBase}?pinId=${pinId}`);
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

      logger.debug('Identity response', { data });

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
      logger.error('Connection test failed', { error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        message: 'Could not connect to Plex server. Check server URL and token.',
      };
    }
  }

  /**
   * Get server-specific access token for a user
   *
   * Per Plex API docs: plex.tv OAuth tokens are for talking to plex.tv,
   * but you need server-specific access tokens from /api/v2/resources to talk to PMS.
   *
   * @param serverMachineId - The machine identifier of the PMS
   * @param userPlexToken - The user's plex.tv OAuth token
   * @returns The server-specific access token, or null if not found/no access
   */
  async getServerAccessToken(
    serverMachineId: string,
    userPlexToken: string
  ): Promise<string | null> {
    try {
      logger.debug('Fetching server access token', { serverMachineId });

      // Get the list of servers/resources the user has access to
      const response = await this.client.get('https://plex.tv/api/v2/resources', {
        headers: {
          'X-Plex-Token': userPlexToken,
          'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
          'Accept': 'application/json',
        },
        params: {
          includeHttps: 1,
          includeRelay: 1,
        },
        timeout: 10000,
      });

      const resources = response.data || [];

      // Find the server resource matching the machine ID
      const serverResource = resources.find((r: any) => {
        const resourceId = r.clientIdentifier || r.machineIdentifier;
        return resourceId === serverMachineId;
      });

      if (!serverResource) {
        logger.warn('User does not have access to server', { serverMachineId });
        return null;
      }

      if (!serverResource.accessToken) {
        logger.error('Server resource found but no accessToken provided');
        return null;
      }

      logger.debug('Found server access token', { serverName: serverResource.name });
      return serverResource.accessToken;

    } catch (error) {
      logger.error('Failed to fetch server access token', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Verify user has access to the configured Plex server
   * Returns true if user can access the server, false otherwise
   *
   * This checks if the server appears in the user's list of accessible servers
   * from plex.tv, which properly validates shared access permissions.
   */
  async verifyServerAccess(serverUrl: string, serverMachineId: string, userToken: string): Promise<boolean> {
    try {
      logger.debug('Verifying server access', { serverMachineId });

      // Get the list of servers/resources the user has access to
      const response = await this.client.get('https://plex.tv/api/v2/resources', {
        headers: {
          'X-Plex-Token': userToken,
          'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
          'Accept': 'application/json',
        },
        params: {
          includeHttps: 1,
          includeRelay: 1,
        },
        timeout: 10000,
      });

      const resources = response.data || [];
      logger.debug('User has access to resources', { count: resources.length });

      // Log all resources for debugging
      logger.debug('User accessible resources', {
        resources: resources.map((r: any) => ({
          name: r.name,
          product: r.product,
          provides: r.provides,
          clientIdentifier: r.clientIdentifier,
          machineIdentifier: r.machineIdentifier,
          owned: r.owned,
        }))
      });

      // Filter to only server resources (not clients like apps)
      const servers = resources.filter((r: any) =>
        r.provides === 'server' ||
        r.product === 'Plex Media Server' ||
        (r.provides && r.provides.includes && r.provides.includes('server'))
      );

      logger.debug('Found server resources', { count: servers.length });

      // Check if our server is in the list of accessible resources
      const hasAccess = servers.some((resource: any) => {
        const resourceId = resource.clientIdentifier || resource.machineIdentifier;
        const match = resourceId === serverMachineId;

        logger.debug('Comparing resource', {
          resourceId,
          serverMachineId,
          match,
          name: resource.name,
        });

        if (match) {
          logger.debug('Found matching server', {
            name: resource.name,
            machineId: resourceId,
            owned: resource.owned,
          });
        }

        return match;
      });

      if (!hasAccess) {
        logger.warn('Server not found in user accessible resources', {
          serverMachineId,
          accessibleServers: servers.map((r: any) => ({
            name: r.name,
            clientId: r.clientIdentifier,
            machineId: r.machineIdentifier,
          }))
        });
      }

      return hasAccess;
    } catch (error: any) {
      logger.error('Failed to verify server access', {
        status: error.response?.status,
        error: error.message,
        responseData: error.response?.data
      });
      return false;
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
      logger.error('Failed to get libraries', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to retrieve libraries from Plex server');
    }
  }

  /**
   * Get recently added items from a library (lightweight polling method)
   * Uses sort by addedAt descending with pagination
   */
  async getRecentlyAdded(
    serverUrl: string,
    authToken: string,
    libraryId: string,
    limit: number = 10
  ): Promise<PlexAudiobook[]> {
    try {
      const response = await this.client.get(
        `${serverUrl}/library/sections/${libraryId}/all`,
        {
          params: {
            type: 9, // Type 9 = Albums (books in audiobook context)
            sort: 'addedAt:desc',
            'X-Plex-Container-Start': 0,
            'X-Plex-Container-Size': limit,
          },
          headers: {
            'X-Plex-Token': authToken,
            'Accept': 'application/json',
          },
        }
      );

      logger.debug('Recently added response type', { type: typeof response.data });

      // Handle XML response
      let data = response.data;
      if (typeof data === 'string') {
        logger.debug('Parsing XML response...');
        const parsed = await parseStringPromise(data);
        data = parsed.MediaContainer;
      } else if (data && typeof data === 'object') {
        // JSON response - could be wrapped in MediaContainer
        if (data.MediaContainer) {
          logger.debug('Extracting from MediaContainer wrapper');
          data = data.MediaContainer;
        }
      }

      const tracks = data.Metadata || data.Track || data.Directory || data.Album || [];
      logger.debug('Found recently added items', { count: Array.isArray(tracks) ? tracks.length : 'not an array' });

      if (!Array.isArray(tracks)) {
        logger.warn('tracks is not an array', { tracks });
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
        userRating: item.userRating ? parseFloat(item.userRating) : (item.$?.userRating ? parseFloat(item.$?.userRating) : undefined),
      }));
    } catch (error) {
      logger.error('Failed to get recently added content', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to retrieve recently added content from Plex library');
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

      logger.debug('Library content response type', { type: typeof response.data });

      // Handle XML response
      let data = response.data;
      if (typeof data === 'string') {
        logger.debug('Parsing XML response...');
        const parsed = await parseStringPromise(data);
        data = parsed.MediaContainer;
      } else if (data && typeof data === 'object') {
        // JSON response - could be wrapped in MediaContainer
        if (data.MediaContainer) {
          logger.debug('Extracting from MediaContainer wrapper');
          data = data.MediaContainer;
        }
      }

      logger.debug('Data structure', { keys: Object.keys(data || {}) });

      const tracks = data.Metadata || data.Track || data.Directory || data.Album || [];
      logger.debug('Found items', { count: Array.isArray(tracks) ? tracks.length : 'not an array' });

      if (!Array.isArray(tracks)) {
        logger.warn('tracks is not an array', { tracks });
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
        userRating: item.userRating ? parseFloat(item.userRating) : (item.$?.userRating ? parseFloat(item.$?.userRating) : undefined),
      }));
    } catch (error: any) {
      if (error?.response?.status === 401) {
        logger.error('401 Unauthorized when fetching library content - token may not have server access permissions');
      } else {
        logger.error('Failed to get library content', { error: error instanceof Error ? error.message : String(error) });
      }
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

      logger.info(`Triggered library scan for library ${libraryId}`);
    } catch (error) {
      logger.error('Failed to trigger scan', { error: error instanceof Error ? error.message : String(error) });
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
      logger.error('Failed to search library', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Get metadata for a specific item (by ratingKey) with user's personal rating
   * This fetches the item with the user's auth token, which includes their personal rating
   */
  async getItemMetadata(
    serverUrl: string,
    authToken: string,
    ratingKey: string
  ): Promise<{ userRating?: number } | null> {
    try {
      const response = await this.client.get(
        `${serverUrl}/library/metadata/${ratingKey}`,
        {
          headers: {
            'X-Plex-Token': authToken,
            'Accept': 'application/json',
          },
        }
      );

      let data = response.data;

      // Handle different response formats
      if (typeof data === 'string') {
        const parsed = await parseStringPromise(data);
        data = parsed.MediaContainer;
      } else if (data && typeof data === 'object') {
        if (data.MediaContainer) {
          data = data.MediaContainer;
        }
      }

      // Extract first metadata item
      const items = data.Metadata || [];
      if (!Array.isArray(items) || items.length === 0) {
        return null;
      }

      const item = items[0];
      return {
        userRating: item.userRating
          ? parseFloat(item.userRating)
          : (item.$?.userRating ? parseFloat(item.$?.userRating) : undefined),
      };
    } catch (error: any) {
      // Handle 401 specifically (expired or invalid token)
      if (error.response?.status === 401) {
        logger.warn('User token unauthorized', { ratingKey, reason: 'token may be expired or invalid' });
        return null;
      }
      // Handle 404 (item not found or user doesn't have access)
      if (error.response?.status === 404) {
        logger.warn('Item not found or no access', { ratingKey });
        return null;
      }
      logger.error('Failed to get metadata', { ratingKey, error: error.message || String(error) });
      return null;
    }
  }

  /**
   * Batch fetch ratings for multiple items using user's token
   * Returns a map of ratingKey -> userRating
   */
  async batchGetUserRatings(
    serverUrl: string,
    authToken: string,
    ratingKeys: string[]
  ): Promise<Map<string, number>> {
    const ratingsMap = new Map<string, number>();
    let unauthorizedCount = 0;

    // Fetch ratings in parallel (limit concurrency to avoid overwhelming Plex)
    const BATCH_SIZE = 10;
    for (let i = 0; i < ratingKeys.length; i += BATCH_SIZE) {
      const batch = ratingKeys.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(ratingKey => this.getItemMetadata(serverUrl, authToken, ratingKey))
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value?.userRating) {
          const ratingKey = batch[index];
          ratingsMap.set(ratingKey, result.value.userRating);
        } else if (result.status === 'rejected') {
          // Count authorization failures
          if (result.reason?.response?.status === 401) {
            unauthorizedCount++;
          }
        }
      });
    }

    // If we got many 401s, log a warning about token issues
    if (unauthorizedCount > 0) {
      logger.warn('Some rating requests failed with 401', { unauthorizedCount, totalCount: ratingKeys.length });
      if (unauthorizedCount === ratingKeys.length) {
        logger.error('All rating requests failed with 401 - user needs to re-authenticate');
      }
    }

    return ratingsMap;
  }

  /**
   * Delete a library item by ratingKey
   * Note: Deletion must be enabled in Plex under Settings > Server > Library
   *
   * @param serverUrl - The Plex server URL
   * @param authToken - Authentication token
   * @param ratingKey - The ratingKey of the item to delete
   */
  async deleteItem(
    serverUrl: string,
    authToken: string,
    ratingKey: string
  ): Promise<void> {
    try {
      await this.client.delete(
        `${serverUrl}/library/metadata/${ratingKey}`,
        {
          headers: {
            'X-Plex-Token': authToken,
          },
        }
      );

      logger.info(`Deleted Plex library item with ratingKey ${ratingKey}`);
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.warn('Item not found in Plex library', { ratingKey });
        // Don't throw - item might already be deleted
        return;
      }
      logger.error('Failed to delete Plex library item', {
        ratingKey,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to delete item from Plex library');
    }
  }

  /**
   * Get list of Plex Home users/profiles
   * Returns all managed users and home members for the authenticated account
   */
  async getHomeUsers(authToken: string): Promise<PlexHomeUser[]> {
    try {
      logger.debug('Fetching home users');
      const response = await this.client.get(
        'https://plex.tv/api/home/users',
        {
          headers: {
            'Accept': 'application/json',
            'X-Plex-Token': authToken,
            'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
          },
        }
      );

      logger.debug('Home users API response', { status: response.status, type: typeof response.data });

      // Handle XML response
      let data = response.data;
      if (typeof data === 'string') {
        logger.debug('Response is XML string, parsing...');
        const parsed = await parseStringPromise(data);
        data = parsed;
        logger.debug('Parsed XML structure', { data });
      } else {
        logger.debug('Response is JSON', { data });
      }

      // Extract users from response
      // Response structure: { home: { users: [{ user: {...} }] } } or similar
      const users: any[] = [];

      logger.debug('Checking for users in response', {
        hasMediaContainer: !!data.MediaContainer,
        hasMediaContainerUser: !!data.MediaContainer?.User,
        hasHome: !!data.home,
        hasHomeUsers: !!data.home?.users,
        hasUsers: !!data.users
      });

      // Check for users in MediaContainer.User (XML response structure)
      if (data.MediaContainer?.User) {
        logger.debug('Found users in data.MediaContainer.User');
        const usersList = Array.isArray(data.MediaContainer.User) ? data.MediaContainer.User : [data.MediaContainer.User];
        logger.debug('usersList length', { count: usersList.length });
        usersList.forEach((item: any) => {
          // XML parsed data has attributes in the $ property
          if (item.$) {
            users.push(item.$);
          } else {
            users.push(item);
          }
        });
      } else if (data.home?.users) {
        logger.debug('Found users in data.home.users');
        const usersList = Array.isArray(data.home.users) ? data.home.users : [data.home.users];
        logger.debug('usersList length', { count: usersList.length });
        usersList.forEach((item: any) => {
          if (item.user) {
            users.push(item.user);
          } else if (item.$) {
            users.push(item.$);
          } else {
            users.push(item);
          }
        });
      } else if (data.users) {
        logger.debug('Found users in data.users');
        const usersList = Array.isArray(data.users) ? data.users : [data.users];
        logger.debug('usersList length', { count: usersList.length });
        usersList.forEach((item: any) => {
          if (item.user) {
            users.push(item.user);
          } else if (item.$) {
            users.push(item.$);
          } else {
            users.push(item);
          }
        });
      } else {
        logger.debug('No users found in expected locations', { data });
      }

      logger.debug('Extracted users from response', { count: users.length });

      if (users.length === 0) {
        logger.warn('No home users found - account may not have Plex Home setup');
        return [];
      }

      return users.map((user: any) => {
        // Handle both direct properties and $ properties (from XML parsing)
        const id = user.id || '';
        const uuid = user.uuid || '';
        const title = user.title || '';
        const username = user.username || '';
        const email = user.email || '';
        const thumb = user.thumb || '';
        const hasPassword = user.hasPassword === '1' || user.hasPassword === 'true' || user.hasPassword === true;
        const restricted = user.restricted === '1' || user.restricted === 'true' || user.restricted === true;
        const admin = user.admin === '1' || user.admin === 'true' || user.admin === true;
        const guest = user.guest === '1' || user.guest === 'true' || user.guest === true;
        const protectedUser = user.protected === '1' || user.protected === 'true' || user.protected === true;

        return {
          id,
          uuid,
          title,
          friendlyName: title, // In Plex Home API, 'title' is the friendly display name
          username,
          email,
          thumb,
          hasPassword,
          restricted,
          admin,
          guest,
          protected: protectedUser,
        };
      });
    } catch (error: any) {
      logger.error('Failed to get home users', {
        error: error.message || String(error),
        status: error.response?.status,
        responseData: error.response?.data
      });
      // Return empty array if no home users (not an error condition)
      return [];
    }
  }

  /**
   * Switch to a specific Plex Home user/profile
   * Returns the authentication token for the selected profile
   */
  async switchHomeUser(
    userId: string,
    authToken: string,
    pin?: string
  ): Promise<string | null> {
    try {
      const params: any = {};
      if (pin) {
        params.pin = pin;
      }

      const response = await this.client.post(
        `https://plex.tv/api/home/users/${userId}/switch`,
        null,
        {
          params,
          headers: {
            'Accept': 'application/json',
            'X-Plex-Token': authToken,
            'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
          },
        }
      );

      // Handle XML response
      let data = response.data;
      if (typeof data === 'string') {
        const parsed = await parseStringPromise(data);
        data = parsed;
      }

      // Extract authenticationToken from response
      // Response structure varies: could be in root, in user object, or in attributes
      let authenticationToken: string | null = null;

      if (data.authenticationToken) {
        authenticationToken = data.authenticationToken;
      } else if (data.user?.authenticationToken) {
        authenticationToken = data.user.authenticationToken;
      } else if (data.$?.authenticationToken) {
        authenticationToken = data.$?.authenticationToken;
      } else if (data.user?.$?.authenticationToken) {
        authenticationToken = data.user.$?.authenticationToken;
      }

      if (!authenticationToken) {
        logger.error('No authenticationToken found in switch response', { data });
        return null;
      }

      return authenticationToken;
    } catch (error: any) {
      // Handle PIN errors specifically
      if (error.response?.status === 401) {
        logger.error('Invalid PIN for profile');
        throw new Error('Invalid PIN');
      }
      logger.error('Failed to switch home user', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to switch to selected profile');
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
