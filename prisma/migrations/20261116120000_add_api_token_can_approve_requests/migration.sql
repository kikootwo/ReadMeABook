-- An API token that may approve requests (opt-in, set only when an admin creates their own token).
-- NOT NULL DEFAULT false: every existing token reads false.
-- The startup schema sync (prisma db push) applies it; this file documents the change.
ALTER TABLE "api_tokens" ADD COLUMN "can_approve_requests" BOOLEAN NOT NULL DEFAULT false;
