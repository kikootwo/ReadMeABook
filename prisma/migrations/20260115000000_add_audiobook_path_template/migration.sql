-- Add audiobook path template configuration
-- This allows admin to customize the folder/file path template for organized audiobooks
-- Template supports placeholders: {author}, {title}, {asin}

-- Insert default configuration for audiobook path template
INSERT INTO configuration (id, key, value, encrypted, category, description, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'audiobook_path_template',
  '{author}/{title} {[asin]}',
  false,
  'automation',
  'Template for organizing audiobook file paths. Supports placeholders: {author}, {title}, {asin}. Example: "{author}/{title} {[asin]}" creates "Author Name/Book Title [ASIN]/audiobook.m4b"',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
