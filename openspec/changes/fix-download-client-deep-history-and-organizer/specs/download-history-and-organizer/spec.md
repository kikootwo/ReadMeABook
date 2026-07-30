## ADDED Requirements

### Requirement: Direct NZO and Deep History Lookup
The system SHALL query SABnzbd history directly by NZO ID (`mode=history&nzo_ids=...`) and support deep paginated history searches without an arbitrary 100-item cutoff.

#### Scenario: Fetching Completed NZB Past Top 100 History Limit
- **WHEN** a completed download rolls past position 100 in SABnzbd history
- **THEN** the download client integration queries SABnzbd by NZO ID directly and returns valid completion status to the monitor processor.

### Requirement: Orphaned Completed Download Folder Scanner
The system SHALL periodically scan completed download directories and automatically match un-imported completed folders to requests stuck in `downloading` or `awaiting_import` status.

#### Scenario: Auto-Organizing Completed Downloads Left in Storage
- **WHEN** a completed audiobook folder exists in `/storage/downloads/nzb/complete/default/` for a request in `downloading` status
- **THEN** the orphaned download scanner matches the folder and enqueues an `organize_files` job to move media into the library.

### Requirement: SABnzbd Duplicate Rejection Recovery
The system SHALL classify SABnzbd duplicate NZB rejections as potential existing downloads and verify file existence before marking requests as failed.

#### Scenario: Recovering Rejected Duplicate NZB
- **WHEN** SABnzbd rejects an NZB submission with duplicate status `Failed` and message containing `"duplicate nzb"`
- **THEN** the system verifies if the completed media file exists in storage and transitions the request to `downloaded` / `available` status instead of `failed`.
