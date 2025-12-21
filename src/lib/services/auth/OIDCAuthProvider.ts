/**
 * OIDC Auth Provider Implementation
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { Issuer, Client, generators } from 'openid-client';
import {
  IAuthProvider,
  UserInfo,
  AuthTokens,
  LoginInitiation,
  CallbackParams,
  AuthResult,
} from './IAuthProvider';
import { getConfigService } from '@/lib/services/config.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { getBaseUrl } from '@/lib/utils/url';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { prisma } from '@/lib/db';

// In-memory storage for OIDC flow state (temporary until callback completes)
// In production, this could be replaced with Redis for multi-instance support
interface OIDCFlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  timestamp: number;
}

const flowStateCache = new Map<string, OIDCFlowState>();
const FLOW_STATE_TTL = 10 * 60 * 1000; // 10 minutes

export class OIDCAuthProvider implements IAuthProvider {
  type: 'oidc' = 'oidc';
  private configService = getConfigService();
  private encryptionService = getEncryptionService();
  private client: Client | null = null;

  /**
   * Get or create OIDC client
   */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    const issuerUrl = await this.configService.get('oidc.issuer_url');
    const clientId = await this.configService.get('oidc.client_id');
    const clientSecret = await this.configService.get('oidc.client_secret');

    if (!issuerUrl || !clientId || !clientSecret) {
      throw new Error('OIDC is not fully configured');
    }

    // Discover OIDC endpoints
    const issuer = await Issuer.discover(issuerUrl);

    // Create client
    this.client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [await this.getRedirectUri()],
      response_types: ['code'],
    });

    return this.client;
  }

  /**
   * Get redirect URI for OAuth callback
   */
  private async getRedirectUri(): Promise<string> {
    const baseUrl = getBaseUrl();
    return `${baseUrl}/api/auth/oidc/callback`;
  }

  /**
   * Initiate OIDC login flow
   */
  async initiateLogin(): Promise<LoginInitiation> {
    try {
      const client = await this.getClient();
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);

      // Store state in memory cache
      flowStateCache.set(state, {
        state,
        nonce,
        codeVerifier,
        timestamp: Date.now(),
      });

      // Clean up expired states
      this.cleanupExpiredStates();

      // Generate authorization URL
      const redirectUrl = client.authorizationUrl({
        scope: 'openid profile email groups',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      return {
        redirectUrl,
        state,
      };
    } catch (error) {
      console.error('[OIDCAuthProvider] Failed to initiate login:', error);
      throw new Error('Failed to initiate OIDC authentication');
    }
  }

  /**
   * Handle OIDC callback
   */
  async handleCallback(params: CallbackParams): Promise<AuthResult> {
    try {
      const { code, state, error } = params;

      if (error) {
        return {
          success: false,
          error: `OIDC provider error: ${error}`,
        };
      }

      if (!code || !state) {
        return {
          success: false,
          error: 'Missing authorization code or state',
        };
      }

      // Retrieve stored flow state
      const flowState = flowStateCache.get(state);
      if (!flowState) {
        return {
          success: false,
          error: 'Invalid or expired state parameter',
        };
      }

      // Clean up state after retrieval
      flowStateCache.delete(state);

      const client = await this.getClient();
      const redirectUri = await this.getRedirectUri();

      if (process.env.LOG_LEVEL === 'debug') {
        console.debug('[OIDCAuthProvider] Exchanging code for tokens', {
          redirectUri,
          hasCode: !!code,
          hasState: !!state,
          stateMatches: state === flowState.state,
        });
      }

      // Exchange code for tokens
      const tokenSet = await client.callback(
        redirectUri,
        { code, state },
        {
          code_verifier: flowState.codeVerifier,
          nonce: flowState.nonce,
          state: flowState.state,
        }
      );

      if (!tokenSet.access_token) {
        return {
          success: false,
          error: 'Failed to obtain access token',
        };
      }

      // Get user info from OIDC provider
      const userinfo = await client.userinfo(tokenSet.access_token);

      if (!userinfo.sub) {
        return {
          success: false,
          error: 'Invalid user info from OIDC provider',
        };
      }

      // Check access control
      const hasAccess = await this.checkAccessControl(userinfo);
      if (!hasAccess) {
        return {
          success: false,
          error: 'You do not have access to this application',
        };
      }

      // Map OIDC claims to UserInfo
      const username = (userinfo.preferred_username || userinfo.email || userinfo.sub) as string;
      const email = userinfo.email as string | undefined;
      const avatarUrl = userinfo.picture as string | undefined;

      // Check admin role from claims
      const isAdminFromClaim = await this.checkAdminClaim(userinfo);

      // Check if admin approval required
      const accessMethod = await this.configService.get('oidc.access_control_method');
      if (accessMethod === 'admin_approval') {
        const existingUser = await this.findUserByOIDCSubject(userinfo.sub);

        if (!existingUser) {
          // Create pending user
          await this.createPendingUser(userinfo.sub, username, email, avatarUrl);
          return {
            success: false,
            requiresApproval: true,
          };
        }

        if (existingUser.registrationStatus === 'pending_approval') {
          return {
            success: false,
            requiresApproval: true,
          };
        }

        if (existingUser.registrationStatus === 'rejected') {
          return {
            success: false,
            error: 'Your account has been rejected by an administrator',
          };
        }
      }

      // Create or update user
      const result = await this.createOrUpdateUser(
        userinfo.sub,
        username,
        email,
        avatarUrl,
        isAdminFromClaim
      );

      // Generate JWT tokens
      const tokens = await this.generateTokens(result.userInfo);

      return {
        success: true,
        user: result.userInfo,
        tokens,
        isFirstLogin: result.isFirstLogin,
      };
    } catch (error) {
      console.error('[OIDCAuthProvider] Callback failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  /**
   * Check if user has access to the application
   */
  private async checkAccessControl(userinfo: any): Promise<boolean> {
    const method = await this.configService.get('oidc.access_control_method');

    switch (method) {
      case 'open':
        return true;

      case 'group_claim': {
        const claimName = (await this.configService.get('oidc.access_group_claim')) || 'groups';
        const requiredGroup = await this.configService.get('oidc.access_group_value');

        if (!requiredGroup) {
          console.error('[OIDCAuthProvider] Group claim access control enabled but no required group configured');
          return false;
        }

        const userGroups = userinfo[claimName] || [];
        if (Array.isArray(userGroups)) {
          return userGroups.includes(requiredGroup);
        }
        return userGroups === requiredGroup;
      }

      case 'allowed_list': {
        const allowedEmailsStr = await this.configService.get('oidc.allowed_emails');
        const allowedUsernamesStr = await this.configService.get('oidc.allowed_usernames');

        const allowedEmails = allowedEmailsStr ? JSON.parse(allowedEmailsStr) : [];
        const allowedUsernames = allowedUsernamesStr ? JSON.parse(allowedUsernamesStr) : [];

        return (
          allowedEmails.includes(userinfo.email) ||
          allowedUsernames.includes(userinfo.preferred_username)
        );
      }

      case 'admin_approval':
        // Admin approval check happens in handleCallback
        return true;

      default:
        // If no method specified, default to open access
        return true;
    }
  }

  /**
   * Check if user should be granted admin role from OIDC claims
   */
  private async checkAdminClaim(userinfo: any): Promise<boolean> {
    const enabled = await this.configService.get('oidc.admin_claim_enabled');
    if (enabled !== 'true') {
      return false;
    }

    const claimName = (await this.configService.get('oidc.admin_claim_name')) || 'groups';
    const claimValue = await this.configService.get('oidc.admin_claim_value');

    if (!claimValue) {
      return false;
    }

    const userClaims = userinfo[claimName] || [];

    if (Array.isArray(userClaims)) {
      return userClaims.includes(claimValue);
    }

    return userClaims === claimValue;
  }

  /**
   * Find user by OIDC subject
   */
  private async findUserByOIDCSubject(oidcSubject: string) {
    return await prisma.user.findFirst({
      where: {
        oidcSubject,
        authProvider: 'oidc',
      },
    });
  }

  /**
   * Create pending user (for admin approval flow)
   */
  private async createPendingUser(
    oidcSubject: string,
    username: string,
    email: string | undefined,
    avatarUrl: string | undefined
  ) {
    const providerName = await this.configService.get('oidc.provider_name');

    await prisma.user.create({
      data: {
        plexId: oidcSubject, // Use oidcSubject as unique identifier
        plexUsername: username,
        plexEmail: email || null,
        role: 'user',
        isSetupAdmin: false,
        avatarUrl: avatarUrl || null,
        authProvider: 'oidc',
        oidcSubject,
        oidcProvider: providerName || 'unknown',
        registrationStatus: 'pending_approval',
        lastLoginAt: new Date(),
      },
    });
  }

  /**
   * Create or update user in database
   */
  private async createOrUpdateUser(
    oidcSubject: string,
    username: string,
    email: string | undefined,
    avatarUrl: string | undefined,
    isAdminFromClaim: boolean
  ): Promise<{ userInfo: UserInfo; isFirstLogin: boolean }> {
    const providerName = await this.configService.get('oidc.provider_name');

    // Check if this is the first user (should be promoted to admin)
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;
    const role = isFirstUser || isAdminFromClaim ? 'admin' : 'user';

    // Create or update user
    const user = await prisma.user.upsert({
      where: { plexId: oidcSubject },
      create: {
        plexId: oidcSubject, // Use oidcSubject as plexId for unique constraint
        plexUsername: username,
        plexEmail: email || null,
        role,
        isSetupAdmin: isFirstUser,
        avatarUrl: avatarUrl || null,
        authProvider: 'oidc',
        oidcSubject,
        oidcProvider: providerName || 'unknown',
        registrationStatus: 'approved',
        lastLoginAt: new Date(),
      },
      update: {
        plexUsername: username,
        plexEmail: email || null,
        avatarUrl: avatarUrl || null,
        oidcProvider: providerName || 'unknown',
        registrationStatus: 'approved',
        lastLoginAt: new Date(),
        // Update role if admin claim is present
        ...(isAdminFromClaim && { role: 'admin' }),
      },
    });

    // Track if we need to trigger initial jobs
    let shouldTriggerJobs = false;

    // If this is the first user, trigger initial jobs (Audible refresh + Library scan)
    // This happens after OIDC-only setup where no admin was created during wizard
    if (isFirstUser) {
      console.log('[OIDCAuthProvider] First OIDC user created - triggering initial jobs');

      // Check if initial jobs have already been run (avoid duplicate runs)
      const initialJobsRun = await this.configService.get('system.initial_jobs_run');

      if (initialJobsRun !== 'true') {
        shouldTriggerJobs = true;

        // Trigger jobs in background (don't block authentication)
        this.triggerInitialJobs().catch(err => {
          console.error('[OIDCAuthProvider] Failed to trigger initial jobs:', err);
        });
      }
    }

    return {
      userInfo: {
        id: user.id,
        username: user.plexUsername,
        email: user.plexEmail || undefined,
        avatarUrl: user.avatarUrl || undefined,
        isAdmin: user.role === 'admin',
      },
      isFirstLogin: isFirstUser && shouldTriggerJobs,
    };
  }

  /**
   * Trigger initial jobs (Audible refresh + Library scan) after first OIDC login
   * This is called automatically when the first user logs in via OIDC after setup
   */
  private async triggerInitialJobs(): Promise<void> {
    try {
      const schedulerService = getSchedulerService();

      // Get scheduled jobs by type
      const audibleJob = await prisma.scheduledJob.findFirst({
        where: { type: 'audible_refresh' },
      });

      const libraryJob = await prisma.scheduledJob.findFirst({
        where: { type: 'plex_library_scan' },
      });

      console.log('[OIDCAuthProvider] Triggering initial jobs...');

      // Trigger Audible refresh
      if (audibleJob) {
        await schedulerService.triggerJobNow(audibleJob.id);
        console.log('[OIDCAuthProvider] Triggered Audible refresh job');
      } else {
        console.warn('[OIDCAuthProvider] Audible refresh job not found');
      }

      // Trigger Library scan
      if (libraryJob) {
        await schedulerService.triggerJobNow(libraryJob.id);
        console.log('[OIDCAuthProvider] Triggered Library scan job');
      } else {
        console.warn('[OIDCAuthProvider] Library scan job not found');
      }

      // Mark initial jobs as run
      await prisma.configuration.upsert({
        where: { key: 'system.initial_jobs_run' },
        update: { value: 'true' },
        create: { key: 'system.initial_jobs_run', value: 'true' },
      });

      console.log('[OIDCAuthProvider] Initial jobs triggered successfully');
    } catch (error) {
      console.error('[OIDCAuthProvider] Error triggering initial jobs:', error);
      throw error;
    }
  }

  /**
   * Generate JWT access and refresh tokens
   */
  private async generateTokens(userInfo: UserInfo): Promise<AuthTokens> {
    const accessToken = generateAccessToken({
      sub: userInfo.id,
      plexId: userInfo.id, // For backwards compatibility
      username: userInfo.username,
      role: userInfo.isAdmin ? 'admin' : 'user',
    });

    const refreshToken = generateRefreshToken(userInfo.id);

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh JWT tokens
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens | null> {
    // JWT refresh is handled by existing JWT utilities
    // This method is a placeholder for future implementation
    return null;
  }

  /**
   * Validate user has access
   */
  async validateAccess(userInfo: UserInfo): Promise<boolean> {
    try {
      // Check if user exists and is approved
      const user = await prisma.user.findUnique({
        where: { id: userInfo.id },
      });

      if (!user || user.authProvider !== 'oidc') {
        return false;
      }

      if (user.registrationStatus === 'pending_approval' || user.registrationStatus === 'rejected') {
        return false;
      }

      return true;
    } catch (error) {
      console.error('[OIDCAuthProvider] Access validation failed:', error);
      return false;
    }
  }

  /**
   * Clean up expired flow states
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, flowState] of flowStateCache.entries()) {
      if (now - flowState.timestamp > FLOW_STATE_TTL) {
        flowStateCache.delete(state);
      }
    }
  }
}
