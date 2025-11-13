# Phase 3: Automation Engine

**Status:** ⏳ In Development

Multi-stage pipeline transforming requests into downloaded, organized media in Plex.

## Pipeline

```
Request → search_indexers → rank_results → download_torrent
→ monitor_download → process_audiobook → update_plex
```

## Job Types

1. **search_indexers** - Search Prowlarr for torrents
2. **rank_results** - Apply ranking algorithm, select best
3. **download_torrent** - Add to qBittorrent
4. **monitor_download** - Poll progress (10s intervals)
5. **process_audiobook** - Organize files to media directory
6. **update_plex** - Trigger scan, fuzzy match

## Integration Points

**Indexers:** Prowlarr (primary), Jackett (fallback)
**Download Clients:** qBittorrent (primary), Transmission (fallback)
**Media Server:** Plex (scan + match)

## Job Queue (Bull)

- Redis-backed for persistence
- Retry: 3 attempts, exponential backoff (2s, 4s, 8s)
- Priorities: High (10), Medium (5), Low (1)
- Concurrency: 3 concurrent per type
- Jobs survive app restarts

## Config Keys

**Prowlarr:** `indexer.type=prowlarr`, `indexer.prowlarr_url`, `indexer.prowlarr_api_key`
**qBittorrent:** `download_client.type=qbittorrent`, `download_client.qbittorrent_url/username/password`
**Paths:** `paths.download_dir`, `paths.media_dir`

## Related Docs

- [Prowlarr](./prowlarr.md)
- [qBittorrent](./qbittorrent.md)
- [Ranking Algorithm](./ranking-algorithm.md)
- [File Organization](./file-organization.md)
- [Plex Integration](../integrations/plex.md)
