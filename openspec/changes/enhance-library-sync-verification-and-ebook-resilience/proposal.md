# Proposal: Enhance Library Sync Verification and Ebook Resilience

## Executive Summary
This proposal enhances Audiobookshelf (ABS) and Plex library synchronization by adding post-scan item verification, ensuring that requests are only marked as `available` after ABS or Plex explicitly confirms the item is present in the media library. Additionally, it hardens `find-missing-ebooks` and Flaresolverr web scraping against silent rate-limiting failures.

## Problem Statement
- **Premature Available Status:** `organize-files` processor triggers `plex_library_scan` or ABS scan and immediately marks the request as `available`. If ABS takes 45 seconds to scan large audio directories, users see `available` in ReadMeABook before the book can actually be played or downloaded from ABS.
- **Silent Ebook Scrape Failures:** `find-missing-ebooks` failures fail silently without structured log events or retry backoffs when Flaresolverr hits Cloudflare rate limits.

## Proposed Changes
1. **Library Verification Polling:**
   - In `organize-files.processor.ts`, poll Audiobookshelf API (`/api/items?search=...`) up to 3 times (with 5s backoff) to verify the item is indexed before transitioning request status to `available`.
2. **Ebook Scraper Resilience & Retries:**
   - Add backoff retry wrappers and structured error logging in `find-missing-ebooks.processor.ts`.
