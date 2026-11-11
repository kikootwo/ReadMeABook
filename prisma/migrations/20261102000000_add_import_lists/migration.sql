-- CreateTable
CREATE TABLE "import_list_filter_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seed_slug" TEXT,
    "skip_parts_and_sets" BOOLEAN NOT NULL DEFAULT true,
    "title_exclude_patterns" TEXT NOT NULL DEFAULT '[]',
    "author_exclude_patterns" TEXT NOT NULL DEFAULT '[]',
    "require_audible_asin" BOOLEAN NOT NULL DEFAULT true,
    "allow_abridged" BOOLEAN NOT NULL DEFAULT false,
    "min_runtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "max_runtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_publication_year" INTEGER NOT NULL DEFAULT 0,
    "max_publication_year" INTEGER NOT NULL DEFAULT 0,
    "allowed_languages" TEXT NOT NULL DEFAULT '[]',
    "excluded_publishers" TEXT NOT NULL DEFAULT '[]',
    "excluded_narrators" TEXT NOT NULL DEFAULT '[]',
    "excluded_genres" TEXT NOT NULL DEFAULT '[]',
    "included_genres" TEXT NOT NULL DEFAULT '[]',
    "min_audible_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_list_filter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'goodreads-list',
    "list_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_request" BOOLEAN NOT NULL DEFAULT true,
    "sync_interval_hours" INTEGER NOT NULL DEFAULT 24,
    "top_n" INTEGER NOT NULL DEFAULT 100,
    "max_requests_per_sync" INTEGER NOT NULL DEFAULT 0,
    "filter_profile_id" TEXT,
    "source_size" INTEGER,
    "last_synced_at" TIMESTAMP(3),
    "last_successful_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_list_sync_logs" (
    "id" TEXT NOT NULL,
    "import_list_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "new_on_list" INTEGER NOT NULL DEFAULT 0,
    "filtered" INTEGER NOT NULL DEFAULT 0,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "already_have" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "requested" INTEGER NOT NULL DEFAULT 0,
    "stopped_reason" TEXT,
    "error_message" TEXT,
    "details" TEXT,

    CONSTRAINT "import_list_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_list_book_matches" (
    "id" TEXT NOT NULL,
    "external_book_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "asin" TEXT,
    "meta_json" TEXT,
    "no_match" BOOLEAN NOT NULL DEFAULT false,
    "last_search_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_list_book_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_list_filter_profiles_name_key" ON "import_list_filter_profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "import_list_filter_profiles_seed_slug_key" ON "import_list_filter_profiles"("seed_slug");

-- CreateIndex
CREATE UNIQUE INDEX "import_lists_name_key" ON "import_lists"("name");

-- CreateIndex
CREATE UNIQUE INDEX "import_lists_provider_list_id_key" ON "import_lists"("provider", "list_id");

-- CreateIndex
CREATE INDEX "import_list_sync_logs_import_list_id_started_at_idx" ON "import_list_sync_logs"("import_list_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_list_book_matches_external_book_id_key" ON "import_list_book_matches"("external_book_id");

-- CreateIndex
CREATE INDEX "import_list_book_matches_asin_idx" ON "import_list_book_matches"("asin");

-- AddForeignKey
ALTER TABLE "import_lists" ADD CONSTRAINT "import_lists_filter_profile_id_fkey" FOREIGN KEY ("filter_profile_id") REFERENCES "import_list_filter_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_list_sync_logs" ADD CONSTRAINT "import_list_sync_logs_import_list_id_fkey" FOREIGN KEY ("import_list_id") REFERENCES "import_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
