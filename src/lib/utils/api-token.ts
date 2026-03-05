/**
 * Component: API Token Generation Utility
 * Documentation: documentation/backend/services/api-tokens.md
 */

import crypto from 'crypto';
import { API_TOKEN_PREFIX, TOKEN_RANDOM_BYTES, TOKEN_PREFIX_LENGTH } from '../constants/api-tokens';

interface GeneratedToken {
  /** The full token string to return to the user (shown only once) */
  fullToken: string;
  /** SHA-256 hash of the full token (stored in database) */
  tokenHash: string;
  /** Display prefix for identification (first 12 chars) */
  tokenPrefix: string;
}

/**
 * Generate a new API token with its hash and display prefix.
 * The full token is: API_TOKEN_PREFIX + random hex string.
 * Only the hash is stored; the full token is returned once at creation.
 */
export function generateApiToken(): GeneratedToken {
  const randomPart = crypto.randomBytes(TOKEN_RANDOM_BYTES).toString('hex');
  const fullToken = `${API_TOKEN_PREFIX}${randomPart}`;
  const tokenHash = crypto.createHash('sha256').update(fullToken).digest('hex');
  const tokenPrefix = fullToken.substring(0, TOKEN_PREFIX_LENGTH);

  return { fullToken, tokenHash, tokenPrefix };
}
