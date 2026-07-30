# Implementation Tasks: Multi-Pass Search Engine, Title Normalizer, and Indexer Rate-Limiter

- [ ] 1. Create `src/lib/utils/search-cleaner.ts` with `cleanTitle` and `extractPrimaryAuthor` functions
- [ ] 2. Update `src/lib/processors/search-indexers.processor.ts` to implement the 3-pass fallback search pipeline
- [ ] 3. Update `src/lib/integrations/prowlarr.service.ts` to add Axios timeout interrupter and `TransientNetworkError` class
- [ ] 4. Configure Bull worker concurrency ceiling and rate limiter in `src/lib/services/job-queue.service.ts`
- [ ] 5. Write unit tests for title cleaning, author isolation, and multi-pass search fallback logic
