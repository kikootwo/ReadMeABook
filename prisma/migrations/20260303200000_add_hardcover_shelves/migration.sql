-- CreateTable
CREATE TABLE "hardcover_shelves" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "api_token" TEXT NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "book_count" INTEGER,
    "cover_urls" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hardcover_shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hardcover_book_mappings" (
    "id" TEXT NOT NULL,
    "hardcover_book_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "audible_asin" TEXT,
    "cover_url" TEXT,
    "no_match" BOOLEAN NOT NULL DEFAULT false,
    "last_search_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hardcover_book_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hardcover_shelves_user_id_idx" ON "hardcover_shelves"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "hardcover_shelves_user_id_list_id_key" ON "hardcover_shelves"("user_id", "list_id");

-- CreateIndex
CREATE UNIQUE INDEX "hardcover_book_mappings_hardcover_book_id_key" ON "hardcover_book_mappings"("hardcover_book_id");

-- CreateIndex
CREATE INDEX "hardcover_book_mappings_hardcover_book_id_idx" ON "hardcover_book_mappings"("hardcover_book_id");

-- CreateIndex
CREATE INDEX "hardcover_book_mappings_audible_asin_idx" ON "hardcover_book_mappings"("audible_asin");

-- AddForeignKey
ALTER TABLE "hardcover_shelves" ADD CONSTRAINT "hardcover_shelves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
