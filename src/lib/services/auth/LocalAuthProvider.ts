/**
 * Local Auth Provider (Username/Password)
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import bcrypt from 'bcrypt';
import {
  IAuthProvider,
  LoginInitiation,
  CallbackParams,
  AuthResult,
  UserInfo,
  AuthTokens,
} from './IAuthProvider';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { getConfigService } from '@/lib/services/config.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { prisma } from '@/lib/db';

interface LocalLoginParams extends CallbackParams {
  username: string;
  password: string;
}

interface RegisterParams {
  username: string;
  password: string;
}

export class LocalAuthProvider implements IAuthProvider {
  type: 'local' = 'local';
  private configService = getConfigService();
  private encryptionService = getEncryptionService();

  /**
   * Initiate login (no-op for local auth)
   */
  async initiateLogin(): Promise<LoginInitiation> {
    // Local auth doesn't need initiation - return empty
    return {};
  }

  /**
   * Handle login with username/password
   */
  async handleCallback(params: CallbackParams): Promise<AuthResult> {
    try {
      const { username, password } = params as LocalLoginParams;

      if (!username || !password) {
        return { success: false, error: 'Username and password required' };
      }

      // Find user
      const user = await prisma.user.findFirst({
        where: {
          plexUsername: username,
          authProvider: 'local',
        },
      });

      if (!user) {
        return { success: false, error: 'Invalid username or password' };
      }

      // Check registration status
      if (user.registrationStatus === 'pending_approval') {
        return {
          success: false,
          requiresApproval: true,
        };
      }

      if (user.registrationStatus === 'rejected') {
        return { success: false, error: 'Account has been rejected' };
      }

      // Verify password
      let passwordValid = false;
      try {
        // Decrypt the stored hash
        const decryptedHash = this.encryptionService.decrypt(user.authToken || '');
        passwordValid = await bcrypt.compare(password, decryptedHash);
      } catch (error) {
        console.error('[LocalAuthProvider] Password verification failed:', error);
        return { success: false, error: 'Invalid username or password' };
      }

      if (!passwordValid) {
        return { success: false, error: 'Invalid username or password' };
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Generate tokens
      console.log('[LocalAuthProvider] Generating tokens for user:', {
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        role: user.role,
        authProvider: user.authProvider,
      });

      const tokens = await this.generateTokens({
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        isAdmin: user.role === 'admin',
      });

      console.log('[LocalAuthProvider] Tokens generated, returning user data');

      return {
        success: true,
        user: {
          id: user.id,
          plexId: user.plexId,
          username: user.plexUsername,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      console.error('[LocalAuthProvider] Login failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  /**
   * Register a new user
   */
  async register(params: RegisterParams): Promise<AuthResult> {
    try {
      const { username, password } = params;

      // Validate
      if (!username || username.length < 3) {
        return { success: false, error: 'Username must be at least 3 characters' };
      }

      if (!password || password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
      }

      // Check if registration is enabled
      const registrationEnabled = await this.configService.get('auth.registration_enabled');
      if (registrationEnabled !== 'true') {
        return { success: false, error: 'Registration is disabled' };
      }

      // Check username uniqueness
      const existing = await prisma.user.findFirst({
        where: {
          plexUsername: username,
          authProvider: 'local',
        },
      });

      if (existing) {
        return { success: false, error: 'Username already taken' };
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Encrypt the hash before storing
      const encryptedHash = this.encryptionService.encrypt(passwordHash);

      // Determine registration status
      const requireApproval = (await this.configService.get('auth.require_admin_approval')) === 'true';
      const registrationStatus = requireApproval ? 'pending_approval' : 'approved';

      // Check if first user (make admin)
      const userCount = await prisma.user.count();
      const isFirstUser = userCount === 0;

      // Create user
      const user = await prisma.user.create({
        data: {
          plexId: `local-${username}`,
          plexUsername: username,
          authToken: encryptedHash,
          authProvider: 'local',
          role: isFirstUser ? 'admin' : 'user',
          isSetupAdmin: isFirstUser,
          registrationStatus: isFirstUser ? 'approved' : registrationStatus,
          lastLoginAt: new Date(),
        },
      });

      // If requires approval and not first user, return pending status
      if (requireApproval && !isFirstUser) {
        return {
          success: false,
          requiresApproval: true,
        };
      }

      // Generate tokens for immediate login
      const tokens = await this.generateTokens({
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        isAdmin: user.role === 'admin',
      });

      return {
        success: true,
        user: {
          id: user.id,
          plexId: user.plexId,
          username: user.plexUsername,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      console.error('[LocalAuthProvider] Registration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      };
    }
  }

  /**
   * Generate JWT access and refresh tokens
   */
  private async generateTokens(userInfo: UserInfo & { plexId: string }): Promise<AuthTokens> {
    const tokenPayload = {
      sub: userInfo.id,
      plexId: userInfo.plexId,
      username: userInfo.username,
      role: userInfo.isAdmin ? 'admin' : 'user',
    };

    console.log('[LocalAuthProvider] JWT token payload:', tokenPayload);

    const accessToken = generateAccessToken(tokenPayload);
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

      if (!user || user.authProvider !== 'local') {
        return false;
      }

      if (user.registrationStatus === 'pending_approval' || user.registrationStatus === 'rejected') {
        return false;
      }

      return true;
    } catch (error) {
      console.error('[LocalAuthProvider] Access validation failed:', error);
      return false;
    }
  }
}
