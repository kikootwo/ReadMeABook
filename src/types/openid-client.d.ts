/**
 * Type declarations for openid-client
 *
 * openid-client 4.x ships types but its package.json "exports" map has no
 * "types" condition, so with `moduleResolution: "bundler"` (which Next 16.4
 * enforces) TypeScript can't find them. The `openid-client-types` alias in
 * tsconfig.json points at the shipped .d.ts; it is type-only and never imported
 * at runtime, so bundling of the real `openid-client` is unaffected.
 */

declare module 'openid-client' {
  export * from 'openid-client-types';
}
