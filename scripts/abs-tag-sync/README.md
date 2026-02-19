# Audiobookshelf Tag Sync

This utility syncs request data from ReadMeABook (RMAB) to Audiobookshelf (ABS). It identifies which user requested a book and applies a `Requester: [Username]` tag to the item in ABS.

### Features
- **Smart User Mapping:** Cross-matches RMAB/Plex emails with ABS usernames to ensure accurate tagging.
- **Data Preservation:** Performs a deep-merge to ensure existing ABS genres, metadata, and non-sync tags are not overwritten.
- **Multi-User Ready:** Designed to handle multiple requesters per book (anticipating future RMAB updates).

### Setup
1. Ensure the script has access to the RMAB Docker container.
2. Set the following Environment Variables:
   - `ABS_URL`: Your Audiobookshelf URL.
   - `ABS_TOKEN`: Your ABS API Token.
   - `RMAB_CONTAINER`: Name of your RMAB Docker container (default: `readmeabook`).
3. Run via Cron or manually:
   `python3 sync_tags.py`
