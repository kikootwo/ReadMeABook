-- #325a: the ASIN of the Audiobookshelf item a delivered request is linked to, when ABS matched it
-- to another edition. Nullable, written only by the library scans (follow-library-asin.ts).
-- The startup schema sync (prisma db push) applies it; this file documents the change.
ALTER TABLE "audiobooks" ADD COLUMN "library_asin" TEXT;
