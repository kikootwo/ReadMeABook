-- Add discord_cards column: persisted Discord message refs for the live, auto-updating request card
-- posted on /checkout. JSON array of { kind: 'public' | 'dm', channelId, messageId }.
-- Nullable: NULL = request not from Discord, or card delivery produced no message.
ALTER TABLE "requests" ADD COLUMN "discord_cards" JSONB;
