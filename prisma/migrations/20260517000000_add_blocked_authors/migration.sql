-- CreateTable
CREATE TABLE "blocked_authors" (
    "id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_key" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_authors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blocked_authors_author_key_key" ON "blocked_authors"("author_key");

-- CreateIndex
CREATE INDEX "blocked_authors_created_at_idx" ON "blocked_authors"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "blocked_authors" ADD CONSTRAINT "blocked_authors_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
