-- Cache the requester's Discord avatar so admin surfaces can show it instead of a generic
-- placeholder. Discord CDN URLs need the avatar hash, which is not derivable from the user id, so
-- the URL is captured opportunistically from each interaction.
-- Nullable and additive: NULL = no linked Discord account, or no custom Discord avatar.
-- Deliberately separate from "avatar_url" so a Plex/OIDC avatar is never overwritten.
ALTER TABLE "users" ADD COLUMN "discord_avatar_url" TEXT;
