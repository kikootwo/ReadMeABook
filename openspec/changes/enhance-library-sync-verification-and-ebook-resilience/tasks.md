# Tasks: Enhance Library Sync Verification and Ebook Resilience

- [ ] 1. Add `verifyItemExists` method to `src/lib/services/library/audiobookshelf-library.service.ts` <!-- id: task-1-abs-verify-item -->
- [ ] 2. Update `src/lib/processors/organize-files.processor.ts` to poll ABS library verification before marking `available` <!-- id: task-2-organize-files-abs-polling -->
- [ ] 3. Add backoff retries to `src/lib/processors/find-missing-ebooks.processor.ts` <!-- id: task-3-ebook-backoff-retries -->
- [ ] 4. Create unit tests in `tests/services/library/audiobookshelf-library.service.test.ts` <!-- id: task-4-abs-verify-unit-test -->
