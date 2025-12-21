/**
 * Auth Provider Interface
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

export interface UserInfo {
  id: string;              // User UUID
  plexId?: string;         // Plex ID, OIDC subject, or local username
  username: string;
  email?: string;
  avatarUrl?: string;
  role?: string;           // 'admin' | 'user'
  isAdmin?: boolean;       // Deprecated: use role instead
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginInitiation {
  redirectUrl?: string;    // For OAuth/OIDC flows
  pinId?: string;          // For Plex PIN flow
  state?: string;          // CSRF state token
}

export interface CallbackParams {
  code?: string;           // Authorization code
  state?: string;          // CSRF state
  pinId?: string;          // Plex PIN
  error?: string;
  [key: string]: any;      // Allow additional params like username, password
}

export interface AuthResult {
  success: boolean;
  user?: UserInfo;
  tokens?: AuthTokens;
  error?: string;
  requiresApproval?: boolean;  // For pending approval flow
  requiresProfileSelection?: boolean;  // For Plex Home
  profiles?: any[];  // Plex Home profiles
  isFirstLogin?: boolean;  // First user login (initial jobs will run)
}

export interface IAuthProvider {
  type: 'plex' | 'oidc' | 'local';

  // Auth initiation
  initiateLogin(): Promise<LoginInitiation>;

  // Auth completion
  handleCallback(params: CallbackParams): Promise<AuthResult>;

  // Token refresh
  refreshToken(refreshToken: string): Promise<AuthTokens | null>;

  // Validation
  validateAccess(userInfo: UserInfo): Promise<boolean>;
}
