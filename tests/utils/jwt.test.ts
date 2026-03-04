/**
 * Component: JWT Utilities Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  decodeToken,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '@/lib/utils/jwt';

describe('JWT utilities', () => {
  it('generates and verifies access tokens', () => {
    const token = generateAccessToken({
      sub: 'user-1',
      plexId: 'plex-1',
      username: 'user',
      role: 'admin',
    });

    const payload = verifyAccessToken(token);

    expect(payload?.sub).toBe('user-1');
    expect(payload?.role).toBe('admin');
  });

  it('returns null for invalid access tokens', () => {
    const payload = verifyAccessToken('bad-token');

    expect(payload).toBeNull();
  });

  it('generates and verifies refresh tokens', () => {
    const token = generateRefreshToken('user-2');
    const payload = verifyRefreshToken(token);

    expect(payload?.sub).toBe('user-2');
    expect(payload?.type).toBe('refresh');
  });

  it('returns null when refresh token type does not match', () => {
    const invalid = jwt.sign(
      { sub: 'user-3', type: 'access' },
      'change-this-to-another-random-secret-key',
      { expiresIn: '7d' }
    );

    const payload = verifyRefreshToken(invalid);

    expect(payload).toBeNull();
  });

  it('decodes tokens without verification', () => {
    const token = generateAccessToken({
      sub: 'user-4',
      plexId: 'plex-4',
      username: 'user',
      role: 'user',
    });

    const decoded = decodeToken(token) as { sub?: string } | null;

    expect(decoded?.sub).toBe('user-4');
    expect(decodeToken('not-a-jwt')).toBeNull();
  });
});
