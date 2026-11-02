/**
 * Component: JWT Utilities Tests
 * Documentation: documentation/backend/services/auth.md
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => loggerMock },
}));

const SECRET_ENV_VARS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_DOWNLOAD_SECRET', 'CONFIG_ENCRYPTION_KEY'] as const;
const originalEnv = Object.fromEntries(SECRET_ENV_VARS.map((name) => [name, process.env[name]]));

const ENV_ACCESS_SECRET = 'env-access-secret';
const ENV_REFRESH_SECRET = 'env-refresh-secret';
const MASTER_KEY = 'test-config-encryption-key-0123456789abcdef';

// Mirrors the derivation parameters in src/lib/utils/jwt.ts. If this breaks, every
// install relying on derived secrets would be logged out on upgrade.
function deriveExpected(info: string): string {
  return Buffer.from(
    crypto.hkdfSync('sha256', MASTER_KEY, 'readmeabook:jwt-secret-derivation', info, 32)
  ).toString('base64');
}
const DERIVED_ACCESS = deriveExpected('readmeabook:jwt:access:v1');
const DERIVED_REFRESH = deriveExpected('readmeabook:jwt:refresh:v1');

// jwt.ts memoizes resolved secrets, so each test loads a fresh module instance
async function loadJwt() {
  vi.resetModules();
  return import('@/lib/utils/jwt');
}

const makePayload = (sub = 'user-1', role = 'admin') => ({ sub, plexId: `plex-${sub}`, username: 'user', role });

beforeEach(() => {
  for (const name of SECRET_ENV_VARS) delete process.env[name];
});

afterEach(() => {
  for (const name of SECRET_ENV_VARS) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('JWT utilities', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = ENV_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = ENV_REFRESH_SECRET;
  });

  it('generates and verifies access tokens', async () => {
    const { generateAccessToken, verifyAccessToken } = await loadJwt();
    const payload = verifyAccessToken(generateAccessToken(makePayload('user-1', 'admin')));

    expect(payload?.sub).toBe('user-1');
    expect(payload?.role).toBe('admin');
  });

  it('returns null for invalid access tokens', async () => {
    const { verifyAccessToken } = await loadJwt();

    expect(verifyAccessToken('bad-token')).toBeNull();
  });

  it('generates and verifies refresh tokens', async () => {
    const { generateRefreshToken, verifyRefreshToken } = await loadJwt();
    const payload = verifyRefreshToken(generateRefreshToken('user-2'));

    expect(payload?.sub).toBe('user-2');
    expect(payload?.type).toBe('refresh');
  });

  it('returns null when refresh token type does not match', async () => {
    const { verifyRefreshToken } = await loadJwt();
    const invalid = jwt.sign({ sub: 'user-3', type: 'access' }, ENV_REFRESH_SECRET, { expiresIn: '7d' });

    expect(verifyRefreshToken(invalid)).toBeNull();
  });

  it('decodes tokens without verification', async () => {
    const { generateAccessToken, decodeToken } = await loadJwt();
    const decoded = decodeToken(generateAccessToken(makePayload('user-4', 'user'))) as { sub?: string } | null;

    expect(decoded?.sub).toBe('user-4');
    expect(decodeToken('not-a-jwt')).toBeNull();
  });
});

describe('JWT secret resolution', () => {
  it('imports without throwing when no secrets are configured', async () => {
    await expect(loadJwt()).resolves.toBeDefined();
  });

  it('signs with JWT_SECRET and JWT_REFRESH_SECRET from env unchanged', async () => {
    process.env.JWT_SECRET = ENV_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = ENV_REFRESH_SECRET;
    const { generateAccessToken, generateRefreshToken, generateDownloadToken } = await loadJwt();

    expect(() => jwt.verify(generateAccessToken(makePayload()), ENV_ACCESS_SECRET)).not.toThrow();
    expect(() => jwt.verify(generateRefreshToken('user-1'), ENV_REFRESH_SECRET)).not.toThrow();
    expect(() => jwt.verify(generateDownloadToken('user-1', 'req-1'), `${ENV_ACCESS_SECRET}-download`)).not.toThrow();
  });

  it('prefers env secrets over CONFIG_ENCRYPTION_KEY derivation', async () => {
    process.env.JWT_SECRET = ENV_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = ENV_REFRESH_SECRET;
    process.env.CONFIG_ENCRYPTION_KEY = MASTER_KEY;
    const { generateAccessToken, generateRefreshToken, verifyAccessToken } = await loadJwt();

    expect(() => jwt.verify(generateAccessToken(makePayload()), ENV_ACCESS_SECRET)).not.toThrow();
    expect(() => jwt.verify(generateRefreshToken('user-1'), ENV_REFRESH_SECRET)).not.toThrow();
    expect(verifyAccessToken(jwt.sign(makePayload(), DERIVED_ACCESS))).toBeNull();
    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  it('uses JWT_DOWNLOAD_SECRET for download tokens when set', async () => {
    process.env.JWT_SECRET = ENV_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = ENV_REFRESH_SECRET;
    process.env.JWT_DOWNLOAD_SECRET = 'env-download-secret';
    const { generateDownloadToken, verifyDownloadToken } = await loadJwt();
    const token = generateDownloadToken('user-1', 'req-1');

    expect(() => jwt.verify(token, 'env-download-secret')).not.toThrow();
    expect(verifyDownloadToken(token)?.requestId).toBe('req-1');
  });

  it('derives secrets deterministically from CONFIG_ENCRYPTION_KEY', async () => {
    process.env.CONFIG_ENCRYPTION_KEY = MASTER_KEY;
    const first = await loadJwt();
    const token = first.generateAccessToken(makePayload());
    const afterRestart = await loadJwt();

    expect(afterRestart.verifyAccessToken(token)?.sub).toBe('user-1');
    expect(() => jwt.verify(token, DERIVED_ACCESS)).not.toThrow();
  });

  it('derives distinct access, refresh and download secrets', async () => {
    process.env.CONFIG_ENCRYPTION_KEY = MASTER_KEY;
    const { generateAccessToken, generateRefreshToken, generateDownloadToken } = await loadJwt();
    const accessToken = generateAccessToken(makePayload());
    const refreshToken = generateRefreshToken('user-1');
    const downloadToken = generateDownloadToken('user-1', 'req-1');

    expect(DERIVED_ACCESS).not.toBe(DERIVED_REFRESH);
    expect(() => jwt.verify(accessToken, DERIVED_ACCESS)).not.toThrow();
    expect(() => jwt.verify(accessToken, DERIVED_REFRESH)).toThrow();
    expect(() => jwt.verify(refreshToken, DERIVED_REFRESH)).not.toThrow();
    expect(() => jwt.verify(refreshToken, DERIVED_ACCESS)).toThrow();
    expect(() => jwt.verify(downloadToken, `${DERIVED_ACCESS}-download`)).not.toThrow();
    expect(() => jwt.verify(downloadToken, DERIVED_ACCESS)).toThrow();
  });

  it('rejects tokens signed with the former hardcoded fallback secrets (#297)', async () => {
    process.env.CONFIG_ENCRYPTION_KEY = MASTER_KEY;
    const { verifyAccessToken, verifyRefreshToken, verifyDownloadToken } = await loadJwt();

    const forgedAccess = jwt.sign(makePayload('user-1', 'admin'), 'change-this-to-a-random-secret-key', { expiresIn: '1h' });
    const forgedRefresh = jwt.sign({ sub: 'user-1', type: 'refresh' }, 'change-this-to-another-random-secret-key', { expiresIn: '7d' });
    const forgedDownload = jwt.sign(
      { sub: 'user-1', requestId: 'req-1', type: 'download' },
      'change-this-to-a-random-secret-key-download',
      { expiresIn: '30d' }
    );

    expect(verifyAccessToken(forgedAccess)).toBeNull();
    expect(verifyRefreshToken(forgedRefresh)).toBeNull();
    expect(verifyDownloadToken(forgedDownload)).toBeNull();
  });

  it('throws a clear error when neither JWT secrets nor CONFIG_ENCRYPTION_KEY are set', async () => {
    const { generateAccessToken, generateRefreshToken, verifyAccessToken } = await loadJwt();

    expect(() => generateAccessToken(makePayload())).toThrow(/JWT_SECRET.*CONFIG_ENCRYPTION_KEY/);
    expect(() => generateRefreshToken('user-1')).toThrow(/JWT_REFRESH_SECRET/);
    expect(() => verifyAccessToken('any-token')).toThrow(/CONFIG_ENCRYPTION_KEY/);
  });

  it('logs derivation once without exposing secret material', async () => {
    process.env.CONFIG_ENCRYPTION_KEY = MASTER_KEY;
    const { generateAccessToken, generateRefreshToken, verifyAccessToken } = await loadJwt();
    verifyAccessToken(generateAccessToken(makePayload()));
    generateRefreshToken('user-1');

    expect(loggerMock.info).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(loggerMock.info.mock.calls);
    expect(logged).not.toContain(MASTER_KEY);
    expect(logged).not.toContain(DERIVED_ACCESS);
    expect(logged).not.toContain(DERIVED_REFRESH);
  });
});
