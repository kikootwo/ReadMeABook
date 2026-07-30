# Design: Deep Download Client History, Orphaned Download Scanner, and Duplicate Classification

## Architecture Overview

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Monitor Download Processor                        │
 │                                                                        │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │ 1. Direct NZO & Deep History Lookup                              │  │
 │  │    - GET /api?mode=history&nzo_id=<nzo_id>                       │  │
 │  │    - Fallback: Paginated history search                          │  │
 │  └──────────────────────────────────┬───────────────────────────────┘  │
 │                                     │                                  │
 │  ┌──────────────────────────────────▼───────────────────────────────┐  │
 │  │ 2. Orphaned Download Directory Scanner                           │  │
 │  │    - Scan /storage/downloads/nzb/complete/default/              │  │
 │  │    - Match storage paths to requests in 'downloading' status     │  │
 │  │    - Enqueue 'organize_files' job                                │  │
 │  └──────────────────────────────────┬───────────────────────────────┘  │
 │                                     │                                  │
 │  ┌──────────────────────────────────▼───────────────────────────────┐  │
 │  │ 3. SABnzbd Duplicate Rejection Classifier                        │  │
 │  │    - Detect "duplicate nzb" / "already in history"               │  │
 │  │    - Check if media file exists on disk                          │  │
 │  │    - Transition to 'downloaded' / 'available'                    │  │
 │  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Deep History Query (`src/lib/integrations/sabnzbd.service.ts`)
```typescript
async getNZB(nzbId: string): Promise<NZBInfo | null> {
  // Check queue first
  const queue = await this.getQueue();
  const queueItem = queue.find(item => item.nzbId === nzbId);
  if (queueItem) return this.mapQueueItemToNZBInfo(queueItem);

  // Direct NZO query to SABnzbd API (bypasses 100-item history limit)
  const response = await this.client.get('/api', {
    params: { mode: 'history', nzo_ids: nzbId, output: 'json', apikey: this.apiKey }
  });
  const slots = response.data?.history?.slots || [];
  if (slots.length > 0) return this.mapHistoryItemToNZBInfo(slots[0]);

  // Deep fallback history search (limit 500)
  const history = await this.getHistory(500);
  const historyItem = history.find(item => item.nzbId === nzbId);
  if (historyItem) return this.mapHistoryItemToNZBInfo(historyItem);

  return null;
}
```

### 2. Orphaned Download Scanner (`src/lib/processors/scan-orphaned-downloads.processor.ts`)
- Scans completed download directory `/storage/downloads/nzb/complete/default/`.
- Queries database for requests in `downloading` status.
- Matches folder names against request title & author using string distance matching.
- Automatically creates `organize_files` jobs for matched completed folders.

### 3. Duplicate Rejection Classifier (`src/lib/processors/monitor-download.processor.ts`)
- If SABnzbd status is `failed` with message containing `duplicate` or `already in history`:
  - Check if completed file exists in download folder or organized media library.
  - If file exists: Log `"Recovered duplicate download for request"`, trigger `organize_files` or transition status to `downloaded`.

## Test & Validation Plan
1. **History Roll-Off Unit Test:** Mock SABnzbd history response with >100 items. Verify `getNZB()` locates target NZO ID at index 150.
2. **Orphan Scanner Test:** Place sample audiobook folder in completed download directory and mark request as `downloading`. Run scanner and verify `organize_files` job is enqueued and executed.
3. **Duplicate NZB Test:** Simulate SABnzbd duplicate rejection response. Verify request status transitions to `downloaded` instead of `failed`.
