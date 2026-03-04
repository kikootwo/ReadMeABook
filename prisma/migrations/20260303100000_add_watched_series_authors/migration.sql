-- CreateTable
CREATE TABLE "watched_series" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "series_asin" TEXT NOT NULL,
    "series_title" TEXT NOT NULL,
    "cover_art_url" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watched_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watched_authors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "author_asin" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "cover_art_url" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watched_authors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watched_series_user_id_idx" ON "watched_series"("user_id");

-- CreateIndex
CREATE INDEX "watched_series_series_asin_idx" ON "watched_series"("series_asin");

-- CreateIndex
CREATE UNIQUE INDEX "watched_series_user_id_series_asin_key" ON "watched_series"("user_id", "series_asin");

-- CreateIndex
CREATE INDEX "watched_authors_user_id_idx" ON "watched_authors"("user_id");

-- CreateIndex
CREATE INDEX "watched_authors_author_asin_idx" ON "watched_authors"("author_asin");

-- CreateIndex
CREATE UNIQUE INDEX "watched_authors_user_id_author_asin_key" ON "watched_authors"("user_id", "author_asin");

-- AddForeignKey
ALTER TABLE "watched_series" ADD CONSTRAINT "watched_series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watched_authors" ADD CONSTRAINT "watched_authors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
