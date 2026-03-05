-- Normalize existing local usernames to lowercase (idempotent - safe to run multiple times)
-- Only affects local auth users, not Plex/OIDC users
UPDATE users SET plex_username = LOWER(plex_username)
  WHERE auth_provider = 'local' AND deleted_at IS NULL AND plex_username != LOWER(plex_username);

UPDATE users SET plex_id = 'local-' || LOWER(SUBSTRING(plex_id FROM 7))
  WHERE plex_id LIKE 'local-%' AND plex_id NOT LIKE 'local-%-deleted-%' AND plex_id != LOWER(plex_id);
