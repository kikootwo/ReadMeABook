-- Add Plex format coercion configuration
-- This allows admin to enable/disable post-organization file-extension rename to Plex-compatible formats
-- Motivation: issue #166 — Plex silently fails to import .mp4 (and some .m4a) audiobook files
-- Coercion is extension-swap only — no re-encoding, no metadata changes

-- Insert default configuration for Plex format coercion (enabled by default)
INSERT INTO configuration (id, key, value, encrypted, category, description, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'plex_format_coercion_enabled',
  'true',
  false,
  'automation',
  'Rename audio files to Plex-compatible extensions after organization (e.g., .mp4 → .m4b). No re-encoding. Prevents the silent-import failure described in issue #166.',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
