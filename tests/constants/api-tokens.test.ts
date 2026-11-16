/**
 * Component: API Token Constants Tests
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_ALLOWED_ENDPOINTS,
  API_TOKEN_ENDPOINT_DOCS,
  isEndpointAllowed,
  getEndpointPermissions,
  collectEndpointPermissions,
  findMatchingEndpoints,
  type AllowedEndpoint,
} from '@/lib/constants/api-tokens';

describe('endpoint permissions (opt-in entries)', () => {
  const APPROVE = '/api/admin/requests/req-123/approve';

  it('the approve route needs approve_requests on the real allowlist', () => {
    expect(getEndpointPermissions('POST', APPROVE)).toEqual(['approve_requests']);
    expect(getEndpointPermissions('post', APPROVE)).toEqual(['approve_requests']);
    expect(isEndpointAllowed('POST', APPROVE)).toBe(true);
  });

  it('only POST on the approve route is allowed; other methods and neighbours are not', () => {
    expect(isEndpointAllowed('POST', APPROVE)).toBe(true);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) expect(isEndpointAllowed(method, APPROVE)).toBe(false);
    expect(isEndpointAllowed('POST', '/api/admin/requests/req-123/approve/extra')).toBe(false);
    expect(isEndpointAllowed('POST', '/api/admin/requests//approve')).toBe(false);
    expect(isEndpointAllowed('POST', '/api/admin/requests/a/b/approve')).toBe(false);
  });

  it('the approve doc entry carries the same permission and is an admin write', () => {
    const doc = API_TOKEN_ENDPOINT_DOCS.find((d) => d.method === 'POST' && d.path === '/api/admin/requests/:id/approve');
    expect(doc).toMatchObject({ permission: 'approve_requests', requiresAdmin: true, isWrite: true });
    expect(doc?.description).toContain('Approve only');
    expect(doc?.description).toContain('90 days');
    expect(doc?.description).toContain('status=awaiting_approval');
  });

  it('untagged endpoints need no permission', () => {
    expect(getEndpointPermissions('GET', '/api/requests')).toEqual([]);
    expect(getEndpointPermissions('POST', '/api/requests/abc/cancel')).toEqual([]);
    expect(getEndpointPermissions('GET', '/api/nowhere')).toEqual([]);
  });

  it('collects the permissions of every match, even after a broader untagged entry', () => {
    const list: AllowedEndpoint[] = [
      { method: 'POST', path: '/api/admin/requests/:id/:action' },
      { method: 'POST', path: '/api/admin/requests/:id/approve', permission: 'approve_requests' },
    ];
    expect(collectEndpointPermissions(list, 'POST', APPROVE)).toEqual(['approve_requests']);
    expect(collectEndpointPermissions(list, 'POST', '/api/admin/requests/req-123/other')).toEqual([]);
  });

  it('each tagged entry is matched by exactly one entry, so no untagged entry overlaps it', () => {
    const tagged = API_TOKEN_ALLOWED_ENDPOINTS.filter((ep) => ep.permission);
    expect(tagged.length).toBeGreaterThan(0);
    for (const ep of tagged) {
      const sample = ep.path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, 'x');
      const matches = findMatchingEndpoints(API_TOKEN_ALLOWED_ENDPOINTS, ep.method, sample);
      expect(matches, `${ep.method} ${ep.path}`).toEqual([ep]);
    }
  });

  it('the approval setting route and the pending-approval list stay off the allowlist', () => {
    expect(getEndpointPermissions('POST', APPROVE)).toEqual(['approve_requests']);
    for (const method of ['GET', 'PATCH', 'PUT', 'POST']) {
      expect(isEndpointAllowed(method, '/api/admin/settings/api-tokens')).toBe(false);
    }
    expect(isEndpointAllowed('GET', '/api/admin/requests/pending-approval')).toBe(false);
    expect(isEndpointAllowed('POST', '/api/admin/requests/pending-approval')).toBe(false);
  });
});

describe('isEndpointAllowed', () => {
  describe('positive matches (every allowlisted endpoint)', () => {
    const cases: Array<[string, string]> = [
      ['GET', '/api/auth/me'],
      ['GET', '/api/audiobooks/search'],
      ['GET', '/api/requests'],
      ['POST', '/api/requests'],
      ['GET', '/api/requests/abc-uuid-123'],
      ['GET', '/api/requests/00000000-0000-0000-0000-000000000000'],
      ['POST', '/api/requests/abc-uuid-123/cancel'],
      ['GET', '/api/admin/metrics'],
      ['GET', '/api/admin/downloads/active'],
      ['GET', '/api/admin/requests/recent'],
    ];

    it.each(cases)('%s %s is allowed', (method, path) => {
      expect(isEndpointAllowed(method, path)).toBe(true);
    });
  });

  describe('negative matches', () => {
    it('rejects unrelated paths', () => {
      expect(isEndpointAllowed('GET', '/api/admin/settings')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/audiobooks/popular')).toBe(false);
    });

    it('rejects wrong HTTP method', () => {
      expect(isEndpointAllowed('DELETE', '/api/requests')).toBe(false);
      expect(isEndpointAllowed('POST', '/api/requests/abc')).toBe(false);
      expect(isEndpointAllowed('PATCH', '/api/requests/abc')).toBe(false);
    });

    it('rejects sibling sub-routes of /api/requests/:id', () => {
      // The :id placeholder must match a SINGLE segment — anything deeper is excluded.
      expect(isEndpointAllowed('GET', '/api/requests/abc/select-torrent')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/requests/abc/download-token')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/requests/abc/interactive-search')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/requests/abc/manual-search')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/requests/abc/select-ebook')).toBe(false);
      expect(isEndpointAllowed('POST', '/api/requests/abc/select-torrent')).toBe(false);
    });

    it('the cancel route is the only token path that changes a request; nothing deletes one (#228)', () => {
      expect(isEndpointAllowed('DELETE', '/api/requests/abc')).toBe(false);
      expect(isEndpointAllowed('PATCH', '/api/requests/abc')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/requests/abc/cancel')).toBe(false);
      expect(isEndpointAllowed('POST', '/api/requests/abc/cancel/extra')).toBe(false);
      expect(isEndpointAllowed('POST', '/api/requests/abc/def/cancel')).toBe(false);
      expect(isEndpointAllowed('POST', '/api/requests//cancel')).toBe(false);
      expect(isEndpointAllowed('DELETE', '/api/admin/requests/abc')).toBe(false);
    });

    it('the Explicit mark route stays UI-only; marking at creation rides on the allowed POST /api/requests (#542)', () => {
      for (const method of ['PUT', 'GET', 'POST', 'PATCH', 'DELETE']) {
        expect(isEndpointAllowed(method, '/api/requests/abc/explicit')).toBe(false);
      }
      expect(isEndpointAllowed('POST', '/api/requests')).toBe(true);
    });

    it('the cancel route\'s description names every cancellable status and the owner `kept` value', async () => {
      const { API_TOKEN_ENDPOINT_DOCS } = await import('@/lib/constants/api-tokens');
      const { CANCELLABLE_STATUSES } = await import('@/lib/constants/request-statuses');
      const doc = API_TOKEN_ENDPOINT_DOCS.find((d) => d.method === 'POST' && d.path === '/api/requests/:id/cancel');
      for (const status of CANCELLABLE_STATUSES) expect(doc?.description).toContain(status);
      expect(doc?.description).toContain('gets kept in place of kept_shared and kept_not_owned');
    });

    it('rejects partial / extended paths', () => {
      expect(isEndpointAllowed('GET', '/api/request')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/requests/')).toBe(false);
      expect(isEndpointAllowed('GET', '/api/auth/me/extra')).toBe(false);
    });

    it('does not allow empty :id segment to match', () => {
      // `/api/requests/:id` requires at least one char in the segment;
      // a literal `/api/requests` is matched separately.
      expect(isEndpointAllowed('GET', '/api/requests/')).toBe(false);
    });
  });

  describe('method case-insensitivity', () => {
    it('accepts lowercase and mixed-case methods', () => {
      expect(isEndpointAllowed('get', '/api/requests')).toBe(true);
      expect(isEndpointAllowed('Get', '/api/requests')).toBe(true);
      expect(isEndpointAllowed('post', '/api/requests')).toBe(true);
      expect(isEndpointAllowed('PoSt', '/api/requests')).toBe(true);
    });
  });

  describe('docs / allowlist parity', () => {
    it('every documented endpoint is on the allowlist', () => {
      for (const doc of API_TOKEN_ENDPOINT_DOCS) {
        const found = API_TOKEN_ALLOWED_ENDPOINTS.some(
          (ep) => ep.method === doc.method && ep.path === doc.path
        );
        expect(found, `${doc.method} ${doc.path} missing from allowlist`).toBe(true);
      }
    });

    it('every allowlisted endpoint has a docs entry', () => {
      for (const ep of API_TOKEN_ALLOWED_ENDPOINTS) {
        const found = API_TOKEN_ENDPOINT_DOCS.some(
          (doc) => doc.method === ep.method && doc.path === ep.path
        );
        expect(found, `${ep.method} ${ep.path} missing from docs`).toBe(true);
      }
    });
  });
});
