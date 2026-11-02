/**
 * Component: Saved Credential Rule Unit Tests
 * Documentation: documentation/settings-pages.md
 */

import { describe, expect, it, vi } from 'vitest';
import { MASKED_PASSWORD, isSameServiceUrl, resolveSecretForUrl } from '@/lib/utils/saved-credential';

const saved = { secret: 'saved-secret', url: 'http://svc.saved:8080/base' };
const resolve = (supplied: unknown, url: string, extra: Record<string, unknown> = {}) =>
  resolveSecretForUrl({ kind: 'prowlarr', url, supplied, loadSaved: vi.fn(async () => saved), ...extra });

describe('isSameServiceUrl', () => {
  it.each([
    ['http://svc.saved:8080/base/', true],
    ['HTTP://SVC.saved:8080/base', true],
    ['http://svc.saved:8080/other', false],
    ['https://svc.saved:8080/base', false],
    ['http://svc.saved:8081/base', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isSameServiceUrl(url, saved.url)).toBe(expected);
  });
});

describe('resolveSecretForUrl', () => {
  it('uses a newly entered secret without loading the saved one', async () => {
    const loadSaved = vi.fn(async () => saved);
    await expect(resolveSecretForUrl({ kind: 'plex', url: 'http://new', supplied: 'fresh', loadSaved }))
      .resolves.toEqual({ ok: true, secret: 'fresh', reusedSaved: false });
    expect(loadSaved).not.toHaveBeenCalled();
  });

  it('reuses the saved secret for the saved URL', async () => {
    await expect(resolve('••••••••', 'http://svc.saved:8080/base/')).resolves.toEqual({ ok: true, secret: 'saved-secret', reusedSaved: true });
  });

  it.each([
    ['the mask', '••••••••', {}],
    ['the download-client mask', MASKED_PASSWORD, { acceptPasswordMask: true }],
    ['an empty secret', '', { emptyMeansSaved: true }],
    ['an omitted secret', undefined, { emptyMeansSaved: true }],
  ])('refuses %s for a different URL', async (_label, supplied, extra) => {
    const result = await resolve(supplied, 'http://elsewhere:8080', extra);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('for the new address');
  });

  it('treats "********" literally unless the download-client mask is enabled', async () => {
    await expect(resolve(MASKED_PASSWORD, 'http://elsewhere')).resolves.toMatchObject({ ok: true, secret: MASKED_PASSWORD });
  });

  it.each([1, true, {}, ['x']])('rejects a non-string secret %j', async (supplied) => {
    const result = await resolve(supplied, 'http://svc.saved:8080/base');
    expect(result).toMatchObject({ ok: false });
  });

  it('reports a missing saved secret, unless the secret is optional and empty', async () => {
    const none = async () => ({ secret: null, url: null });
    await expect(resolveSecretForUrl({ kind: 'plex', url: 'http://x', supplied: '••••', loadSaved: none, missingMessage: 'none saved' }))
      .resolves.toEqual({ ok: false, error: 'none saved' });
    await expect(resolveSecretForUrl({ kind: 'audiobookshelf', url: 'http://x', supplied: '', emptyMeansSaved: true, optional: true, loadSaved: none }))
      .resolves.toEqual({ ok: true, secret: '', reusedSaved: false });
  });
});
