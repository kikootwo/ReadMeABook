-- Update default audiobook path template to include square brackets around ASIN
-- This improves compatibility with Audiobookshelf ASIN extraction

-- Update existing configuration if it matches the old default
UPDATE configuration
SET value = '{author}/{title} {[asin]}',
    description = 'Template for organizing audiobook file paths. Supports placeholders: {author}, {title}, {asin}. Example: "{author}/{title} {[asin]}" creates "Author Name/Book Title [ASIN]/audiobook.m4b"',
    updated_at = NOW()
WHERE key = 'audiobook_path_template'
  AND (value = '{author}/{title} {asin}' OR value IS NULL);
