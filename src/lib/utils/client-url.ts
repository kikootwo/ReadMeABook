/**
 * Component: Client-side URL Utilities
 * Documentation: documentation/backend/services/api-tokens.md
 */

/**
 * Get the current instance origin URL.
 * Returns window.location.origin on the client, or a placeholder on the server.
 */
export function getInstanceUrl(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'https://your-instance';
}
