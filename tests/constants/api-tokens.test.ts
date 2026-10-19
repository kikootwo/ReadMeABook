/**
 * Component: API Token Constants Tests
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_ALLOWED_ENDPOINTS,
  API_TOKEN_ENDPOINT_DOCS,
  isEndpointAllowed,
} from '@/lib/constants/api-tokens';

describe('isEndpointAllowed', () => {
  describe('positive matches (every allowlisted endpoint)', () => {
    const cases: Array<[string, string]> = [
      ['GET', '/api/auth/me'],
      ['GET', '/api/audiobooks/search'],
      ['GET', '/api/requests'],
      ['POST', '/api/requests'],
      ['GET', '/api/requests/abc-uuid-123'],
      ['GET', '/api/requests/00000000-0000-0000-0000-000000000000'],
      ['GET', '/api/admin/metrics'],
      ['GET', '/api/admin/downloads/active'],
      ['GET', '/api/admin/requests/recent'],
      ['GET', '/api/admin/requests/pending-approval'],
      ['POST', '/api/admin/requests/abc-uuid-123/approve'],
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
