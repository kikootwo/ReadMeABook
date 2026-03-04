-- CreateTable
CREATE TABLE "book_mappings" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_book_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "audible_asin" TEXT,
    "cover_url" TEXT,
    "no_match" BOOLEAN NOT NULL DEFAULT false,
    "last_search_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_mappings_pkey" PRIMARY KEY ("id")
);

-- Migrate data from goodreads_book_mappings
INSERT INTO "book_mappings" ("id", "provider", "external_book_id", "title", "author", "audible_asin", "cover_url", "no_match", "last_search_at", "created_at", "updated_at")
SELECT "id", 'goodreads', "goodreads_book_id", "title", "author", "audible_asin", "cover_url", "no_match", "last_search_at", "created_at", "updated_at"
FROM "goodreads_book_mappings";

-- Migrate data from hardcover_book_mappings
INSERT INTO "book_mappings" ("id", "provider", "external_book_id", "title", "author", "audible_asin", "cover_url", "no_match", "last_search_at", "created_at", "updated_at")
SELECT "id", 'hardcover', "hardcover_book_id", "title", "author", "audible_asin", "cover_url", "no_match", "last_search_at", "created_at", "updated_at"
FROM "hardcover_book_mappings";

-- DropTable
DROP TABLE "goodreads_book_mappings";

-- DropTable
DROP TABLE "hardcover_book_mappings";

-- CreateIndex
CREATE UNIQUE INDEX "book_mappings_provider_external_book_id_key" ON "book_mappings"("provider", "external_book_id");

-- CreateIndex
CREATE INDEX "book_mappings_provider_external_book_id_idx" ON "book_mappings"("provider", "external_book_id");

-- CreateIndex
CREATE INDEX "book_mappings_audible_asin_idx" ON "book_mappings"("audible_asin");
