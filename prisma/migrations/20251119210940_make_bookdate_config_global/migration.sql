-- DropForeignKey
ALTER TABLE "bookdate_config" DROP CONSTRAINT "bookdate_config_user_id_fkey";

-- DropIndex
DROP INDEX "bookdate_config_user_id_idx";

-- DropIndex
DROP INDEX "bookdate_config_user_id_key";

-- AlterTable: Remove userId column and user relation
ALTER TABLE "bookdate_config" DROP COLUMN "user_id";

-- Note: This migration converts BookDateConfig from per-user to a single global configuration
-- managed by admins. Any existing per-user configs will be removed except the first one found.
