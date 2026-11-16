-- API tokens that may approve or deny requests (only while the admin setting
-- api_tokens.allow_request_approval is on). Every existing token gets false.
-- The startup schema sync (prisma db push) applies it; this file documents the change.
ALTER TABLE "api_tokens" ADD COLUMN "can_approve_requests" BOOLEAN NOT NULL DEFAULT false;
