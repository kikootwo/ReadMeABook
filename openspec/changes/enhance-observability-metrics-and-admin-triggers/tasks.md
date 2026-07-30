# Implementation Tasks: Enterprise Observability, Structured Logging, Prometheus Metrics, and Task Triggers

- [ ] 1. Standardize `RMABLogger` in `src/lib/utils/logger.ts` to output structured JSON with correlation IDs
- [ ] 2. Create `src/app/api/metrics/route.ts` using `prom-client` to expose queue, request, and cron metrics
- [ ] 3. Create `src/components/admin/operations-center.tsx` with interactive maintenance trigger buttons
- [ ] 4. Mount Operations Center tab on `/admin/settings` page in the Web UI
- [ ] 5. Write unit and integration tests for JSON logging format and `/api/metrics` endpoint response schema
