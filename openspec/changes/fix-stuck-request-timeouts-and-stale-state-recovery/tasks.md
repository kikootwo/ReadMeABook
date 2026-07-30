# Tasks: Fix Stuck Request Timeouts and Stale State Recovery

- [ ] 1. Create `recover-stuck-requests.processor.ts` in `src/lib/processors/` <!-- id: task-1-recover-stuck-processor -->
- [ ] 2. Register scheduled job `recover_stuck_requests` in `SchedulerService` (`0 * * * *`) <!-- id: task-2-register-recover-job -->
- [ ] 3. Create unit test suite `tests/processors/recover-stuck-requests.processor.test.ts` <!-- id: task-3-recover-stuck-unit-test -->
- [ ] 4. Add "Reset Stuck Requests" button to `OperationsCenter` component <!-- id: task-4-ui-reset-stuck-button -->
