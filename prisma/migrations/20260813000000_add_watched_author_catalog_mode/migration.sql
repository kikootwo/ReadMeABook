ALTER TABLE "watched_authors"
ADD COLUMN "include_back_catalog" BOOLEAN NOT NULL DEFAULT false;

UPDATE "watched_authors"
SET "include_back_catalog" = true;
