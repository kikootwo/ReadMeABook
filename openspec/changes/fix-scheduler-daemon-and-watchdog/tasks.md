# Implementation Tasks: Resilient Scheduler Daemon, In-Container Watchdog, and API Control Surface

- [ ] 1. Enhance `SchedulerService` with internal watchdog interval (`recoverStalledJobs`) in `src/lib/services/scheduler.service.ts`
- [ ] 2. Create REST API control routes `src/app/api/scheduler/status/route.ts`, `src/app/api/scheduler/trigger/route.ts`, and `src/app/api/scheduler/restart/route.ts`
- [ ] 3. Refactor `retry-missing-torrents.processor.ts` to query pending requests in paginated chunks with `orderBy: { lastSearchAt: 'asc' }`
- [ ] 4. Add UI trigger controls to Admin Scheduled Jobs dashboard
- [ ] 5. Add integration tests for watchdog self-healing and API triggers
