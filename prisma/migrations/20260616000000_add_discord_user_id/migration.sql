-- Add discord_user_id column to map a Discord account to an RMAB user (Discord slash-command requesting).
-- Nullable: NULL = not linked. Unique so a Discord account maps to at most one RMAB user; indexed for reverse lookup.
ALTER TABLE "users" ADD COLUMN "discord_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_user_id_key" ON "users"("discord_user_id");

-- CreateIndex
CREATE INDEX "users_discord_user_id_idx" ON "users"("discord_user_id");
