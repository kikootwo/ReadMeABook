-- AlterTable
ALTER TABLE "plex_library" ADD COLUMN "asin" TEXT,
ADD COLUMN "isbn" TEXT;

-- CreateIndex
CREATE INDEX "plex_library_asin_idx" ON "plex_library"("asin");

-- CreateIndex
CREATE INDEX "plex_library_isbn_idx" ON "plex_library"("isbn");
