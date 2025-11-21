-- Add metadata tagging configuration
-- This allows admin to enable/disable automatic metadata tagging of audio files during file organization

-- Insert default configuration for metadata tagging (enabled by default)
INSERT INTO configuration (id, key, value, encrypted, category, description, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'metadata_tagging_enabled',
  'true',
  false,
  'automation',
  'Automatically tag audio files (m4b, mp3) with correct metadata (title, author, narrator) during file organization. Improves Plex matching accuracy.',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
