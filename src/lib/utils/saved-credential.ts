/**
 * Component: Saved Credential Reuse Rules (connection test + settings save routes)
 * Documentation: documentation/settings-pages.md
 *
 * The settings UI sends a masked secret ("••••", or "********" for download
 * clients) meaning "keep the saved one". A saved secret is only reused for the
 * saved URL; testing or saving a different address requires re-entering it.
 */

/** Where to find each credential, shown when it must be re-entered */
export const CREDENTIAL_HELP = {
  audiobookshelf: 'Audiobookshelf API token (in Audiobookshelf: Settings → API Keys, or Settings → Users → your user → API Token on older versions)',
  plex: 'Plex token (X-Plex-Token: in Plex Web, open any item → ⋯ → Get Info → View XML; the token is at the end of the URL)',
  prowlarr: 'Prowlarr API key (in Prowlarr: Settings → General → Security → API Key)',
  downloadClient: 'download client password or API key (SABnzbd: Config → General → API Key; qBittorrent/Transmission/Deluge/NZBGet: the Web UI password)',
  oidc: "OIDC client secret (in your identity provider's application/client settings)",
  apprise: 'Apprise notification URLs, auth token and Basic Auth password (the target-service URLs you configured in Apprise, and the API token or the username/password your Apprise server or its reverse proxy requires)',
  ntfy: 'ntfy access token (in ntfy: Account → Access tokens)',
  bookdate: "AI provider API key (in your AI provider's account or API settings)",
} as const;

export type CredentialKind = keyof typeof CREDENTIAL_HELP;

/** Placeholder the download-client settings UI sends for a saved password */
export const MASKED_PASSWORD = '********';

function normalize(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** True for a valid http(s) URL. */
export function isServiceUrl(value: string | null | undefined): boolean {
  return normalize(value) !== null;
}

/** True when both URLs are valid http(s) URLs with the same origin and path (trailing slash ignored). */
export function isSameServiceUrl(supplied: string | null | undefined, saved: string | null | undefined): boolean {
  const a = normalize(supplied);
  const b = normalize(saved);
  return a !== null && a === b;
}

/** True for the placeholder ("••••…") the settings UI sends instead of a saved secret. */
export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('••••');
}

/** Error text when a saved secret cannot be used for the address being tested or saved. */
export function savedCredentialUrlMismatch(kind: CredentialKind): string {
  return `The saved credential only works with the saved address. Re-enter the ${CREDENTIAL_HELP[kind]} for the new address.`;
}

export interface SavedCredential {
  secret: string | null | undefined;
  url: string | null | undefined;
}

export interface SecretChoice {
  kind: CredentialKind;
  /** URL the secret will be used with (test or save) */
  url: string | null | undefined;
  /** Secret from the request body (may be the mask) */
  supplied: unknown;
  /** Loads the saved secret and the URL it belongs to (only called when needed) */
  loadSaved: () => Promise<SavedCredential> | SavedCredential;
  /** Also treat an empty supplied secret as "use the saved one" */
  emptyMeansSaved?: boolean;
  /** Also treat MASKED_PASSWORD as the mask (download clients) */
  acceptPasswordMask?: boolean;
  /** Error when the saved secret is wanted but none exists */
  missingMessage?: string;
  /** An empty secret is fine when nothing is saved (resolves to '') */
  optional?: boolean;
}

export type SecretResolution =
  | { ok: true; secret: string; reusedSaved: boolean }
  | { ok: false; error: string };

/**
 * Pick the secret to use: the supplied one, or the saved one when the request
 * asks for it AND the URL is the saved URL.
 */
export async function resolveSecretForUrl(choice: SecretChoice): Promise<SecretResolution> {
  if (choice.supplied !== undefined && choice.supplied !== null && typeof choice.supplied !== 'string') {
    return { ok: false, error: 'The password/API key/token must be text.' };
  }
  const supplied = typeof choice.supplied === 'string' ? choice.supplied : '';
  const wantsSaved =
    isMaskedSecret(supplied) ||
    (choice.acceptPasswordMask === true && supplied === MASKED_PASSWORD) ||
    (choice.emptyMeansSaved === true && supplied === '');

  if (!wantsSaved) return { ok: true, secret: supplied, reusedSaved: false };
  const saved = await choice.loadSaved();
  if (!saved.secret) {
    if (choice.optional && supplied === '') return { ok: true, secret: '', reusedSaved: false };
    return { ok: false, error: choice.missingMessage ?? `No saved ${CREDENTIAL_HELP[choice.kind]} found. Please enter it.` };
  }
  if (!isSameServiceUrl(choice.url, saved.url)) {
    return { ok: false, error: savedCredentialUrlMismatch(choice.kind) };
  }
  return { ok: true, secret: saved.secret, reusedSaved: true };
}
