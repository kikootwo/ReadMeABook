-- Add lifetime auto-retry counter for the find_missing_ebooks scheduled job.
-- Nullable: NULL distinguishes "never touched by this job" from 0.
-- Only the find-missing-ebooks processor reads/writes/increments this column.
-- Manual Fetch Ebook routes do not touch it (counter is sacred per engineering brief).
ALTER TABLE "requests" ADD COLUMN "ebook_auto_retry_count" INTEGER;
