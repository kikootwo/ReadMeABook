/**
 * Component: Auth Providers Route Table Tests (every local-login input combination)
 * Documentation: documentation/backend/services/auth.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => {
  const service = {
    get: async (key: string) => config.values[key] ?? null,
    getBackendMode: async () => config.values['system.backend_mode'] || 'plex',
  };
  return {
    ConfigurationService: class {
      get = service.get;
      getBackendMode = service.getBackendMode;
    },
    getConfigService: () => service,
  };
});

type Mode = 'audiobookshelf' | 'plex' | null;
type Disable = 'true' | 'false' | undefined;

interface Case {
  mode: Mode;
  disable: Disable;
  localUsers: number;
  registration: boolean;
  oidc: boolean;
}

const cases: Case[] = [];
for (const mode of ['audiobookshelf', 'plex', null] as Mode[]) {
  for (const disable of [undefined, 'true', 'false'] as Disable[]) {
    for (const localUsers of [0, 1]) {
      for (const registration of [false, true]) {
        for (const oidc of [false, true]) cases.push({ mode, disable, localUsers, registration, oidc });
      }
    }
  }
}

/** The response each combination gets, written out from the route's rules as they stood before the shared helper */
function expected(c: Case) {
  const disabled = c.disable === 'true';
  // explicitMarkEnabled: false here, the key being absent (#542)
  const common = { localLoginDisabled: disabled, allowWeakPassword: false, automationEnabled: false, explicitMarkEnabled: false };
  if (c.mode !== 'audiobookshelf') {
    return {
      backendMode: 'plex',
      providers: ['plex'],
      registrationEnabled: false,
      hasLocalUsers: c.localUsers > 0,
      oidcProviderName: null,
      ...common,
    };
  }
  const providers: string[] = [];
  if (c.oidc) providers.push('oidc');
  if (!disabled && (c.localUsers > 0 || c.registration)) providers.push('local');
  return {
    backendMode: 'audiobookshelf',
    providers,
    registrationEnabled: !disabled && c.registration,
    hasLocalUsers: c.localUsers > 0,
    oidcProviderName: c.oidc ? 'Authentik' : null,
    ...common,
  };
}

describe('GET /api/auth/providers, the Explicit mark flag (#542)', () => {
  it.each([
    ['audiobookshelf', 'true', true],
    ['audiobookshelf', 'false', false],
    ['audiobookshelf', null, false],
    ['plex', 'true', false],
  ] as const)('mode %s, setting %s: explicitMarkEnabled %s', async (mode, value, expectedFlag) => {
    config.values = { 'system.backend_mode': mode, 'audiobookshelf.explicit_mark_enabled': value };
    prismaMock.user.count.mockResolvedValue(0);

    const { GET } = await import('@/app/api/auth/providers/route');
    const payload = await (await GET()).json();

    expect(payload.explicitMarkEnabled).toBe(expectedFlag);
  });
});

describe('GET /api/auth/providers, every local-login input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_LOCAL_LOGIN;
    delete process.env.ALLOW_WEAK_PASSWORD;
  });

  afterEach(() => {
    delete process.env.DISABLE_LOCAL_LOGIN;
  });

  it.each(cases)(
    'mode $mode, DISABLE_LOCAL_LOGIN $disable, local users $localUsers, registration $registration, oidc $oidc',
    async (c) => {
      config.values = {
        'system.backend_mode': c.mode,
        'auth.registration_enabled': String(c.registration),
        'oidc.enabled': String(c.oidc),
        'oidc.provider_name': 'Authentik',
      };
      if (c.disable !== undefined) process.env.DISABLE_LOCAL_LOGIN = c.disable;
      prismaMock.user.count.mockResolvedValue(c.localUsers);

      const { GET } = await import('@/app/api/auth/providers/route');
      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected(c));
    }
  );
});
