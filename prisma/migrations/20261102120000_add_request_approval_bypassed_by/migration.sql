-- #232: records a request that left awaiting_approval, denied or cancelled without an approval
-- (`<path>:<fromStatus>`, for example manual_import:denied). Nullable; NULL on every existing row.
-- The startup schema sync (prisma db push) applies it; this file documents the change.
ALTER TABLE "requests" ADD COLUMN "approval_bypassed_by" TEXT;
