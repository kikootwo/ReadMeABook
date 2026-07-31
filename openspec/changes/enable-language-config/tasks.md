# Tasks: Configurable Preferred Language and Penalty Scoring

- [ ] 1. Add `preferredLanguage` and `languagePenaltyScore` settings to `src/lib/services/system-settings.service.ts` <!-- id: task-1-settings-schema -->
- [ ] 2. Update `src/lib/utils/ranking-algorithm.ts` to accept `preferredLanguage` and `languagePenaltyScore` <!-- id: task-2-ranking-configurable -->
- [ ] 3. Update `src/lib/processors/search-indexers.processor.ts` to pass configured language settings to ranker <!-- id: task-3-processor-wiring -->
- [ ] 4. Add UI dropdown and penalty score input to Admin Settings page <!-- id: task-4-admin-ui -->
- [ ] 5. Create unit test suite `tests/utils/configurable-language-filtering.test.ts` <!-- id: task-5-unit-test -->
