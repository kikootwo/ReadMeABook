-- AlterTable - Add login_token_hash column for admin-generated login tokens
ALTER TABLE "users" ADD COLUMN "login_token_hash" TEXT;
