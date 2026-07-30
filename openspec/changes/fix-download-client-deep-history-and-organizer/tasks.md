# Implementation Tasks: Deep Download Client History, Orphaned Download Scanner, and Duplicate Classification

- [ ] 1. Update `src/lib/integrations/sabnzbd.service.ts` to implement direct `nzo_ids` history lookup and deep paginated queries
- [ ] 2. Create `src/lib/processors/scan-orphaned-downloads.processor.ts` to scan completed download storage folders
- [ ] 3. Update `src/lib/processors/monitor-download.processor.ts` to parse duplicate rejection messages and verify disk files
- [ ] 4. Register `scan_orphaned_downloads` as a scheduled job in `SchedulerService` (runs every 30 minutes)
- [ ] 5. Write unit tests for deep history lookup, orphan folder matching, and duplicate rejection recovery
