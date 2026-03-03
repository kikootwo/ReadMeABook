-- CreateTable
CREATE TABLE "works" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_asins" (
    "id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "narrator" TEXT,
    "duration_minutes" INTEGER,
    "is_canonical" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_asins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "works_title_idx" ON "works"("title");

-- CreateIndex
CREATE INDEX "works_author_idx" ON "works"("author");

-- CreateIndex
CREATE UNIQUE INDEX "work_asins_asin_key" ON "work_asins"("asin");

-- CreateIndex
CREATE INDEX "work_asins_work_id_idx" ON "work_asins"("work_id");

-- CreateIndex
CREATE INDEX "work_asins_asin_idx" ON "work_asins"("asin");

-- AddForeignKey
ALTER TABLE "work_asins" ADD CONSTRAINT "work_asins_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
