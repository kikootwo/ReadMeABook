-- Normalize existing local usernames to lowercase
UPDATE users SET plex_username = LOWER(plex_username) WHERE auth_provider = 'local' AND deleted_at IS NULL;
UPDATE users SET plex_id = 'local-' || LOWER(SUBSTRING(plex_id FROM 7)) WHERE plex_id LIKE 'local-%' AND plex_id NOT LIKE 'local-%-deleted-%';
